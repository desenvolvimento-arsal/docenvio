import './env.js'; // carrega .env antes de qualquer módulo ler process.env
import express from 'express';
import multer from 'multer';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { store, seedIfEmpty } from './store.js';
import { normalizePhoneBR, isNonEmpty, onlyDigits, isValidCNPJ, formatCNPJ } from './validators.js';
import { enviarWhatsApp, whatsappStatus, buildWaLink, evolutionConnect, PROVIDER } from './whatsapp.js';
import { hashSenha, verificarSenha, novoToken, userView, requireAuth, requireAdmin } from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const UPLOAD_DIR = join(ROOT, 'uploads');
const PORT = process.env.PORT || 3000;

if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(express.json());
app.use(express.static(join(ROOT, 'public')));

// ---------------------------------------------------------------- uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = `${Date.now()}-${Math.round(Math.random() * 1e6)}${extname(file.originalname)}`;
    cb(null, safe);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB — aceita qualquer tipo de arquivo
});

// ---------------------------------------------------------------- helpers
const err = (res, status, message) => res.status(status).json({ error: message });

function clienteView(c) {
  const docs = store.where('documentos', (d) => d.cliente_id === c.id).length;
  return { ...c, cnpj_formatado: c.cnpj ? formatCNPJ(c.cnpj) : null, documentos_count: docs };
}

// Situação efetiva: 'vencida' se venceu e não está paga.
function situacaoEfetiva(d) {
  if (d.situacao === 'paga') return 'paga';
  if (d.vencimento && d.vencimento < new Date().toISOString().slice(0, 10)) return 'vencida';
  return d.situacao || 'aberta';
}

function documentoView(d) {
  const cliente = store.find('clientes', d.cliente_id);
  const td = d.tipo_documento_id ? store.find('tipos_documento', d.tipo_documento_id) : null;
  const tp = d.tipo_pagamento_id ? store.find('tipos_pagamento', d.tipo_pagamento_id) : null;
  const ultimoEnvio = store
    .where('envios', (e) => e.documento_id === d.id)
    .sort((a, b) => b.id - a.id)[0];
  return {
    ...d,
    cliente_nome: cliente?.nome ?? '(cliente removido)',
    tipo_documento: td?.descricao ?? null,
    tipo_pagamento: tp?.descricao ?? null,
    situacao: situacaoEfetiva(d),
    status_envio: ultimoEnvio?.status ?? 'nao_enviado',
  };
}

// ================================================================= AUTH
function seedAdmin() {
  if (store.all('users').length > 0) return;
  const email = (process.env.ADMIN_EMAIL || 'admin@docenvio.com').toLowerCase();
  const senha = process.env.ADMIN_PASSWORD || 'admin123';
  store.insert('users', { nome: 'Administrador', email, senha_hash: hashSenha(senha), role: 'admin', ativo: true });
  console.log(`  → Conta admin criada: ${email} / senha: ${senha}`);
}

// Login (rota pública — definida ANTES do requireAuth)
app.post('/api/auth/login', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const user = store.where('users', (u) => u.email.toLowerCase() === email)[0];
  if (!user || !verificarSenha(req.body.senha || '', user.senha_hash)) return err(res, 401, 'E-mail ou senha inválidos.');
  if (!user.ativo) return err(res, 403, 'Conta desativada. Fale com o administrador.');
  const token = novoToken();
  store.insert('sessions', { token, user_id: user.id });
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 24 * 3600 * 1000 });
  res.json({ user: userView(user) });
});

// Daqui em diante, TODA rota /api exige autenticação.
app.use('/api', requireAuth(store));

app.get('/api/auth/me', (req, res) => res.json({ user: userView(req.user) }));
app.post('/api/auth/logout', (req, res) => {
  const s = store.where('sessions', (x) => x.token === req.sessionToken)[0];
  if (s) store.remove('sessions', s.id);
  res.clearCookie('sid', { path: '/' });
  res.json({ ok: true });
});

// -------- Admin: gestão de contas (somente admin) --------
app.get('/api/admin/users', requireAdmin, (_req, res) => {
  res.json(store.all('users').sort((a, b) => a.id - b.id).map(userView));
});
app.post('/api/admin/users', requireAdmin, (req, res) => {
  const nome = (req.body.nome || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const senha = req.body.senha || '';
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  if (!isNonEmpty(nome, 120)) return err(res, 400, 'Nome é obrigatório.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err(res, 400, 'E-mail inválido.');
  if (String(senha).length < 6) return err(res, 400, 'Senha deve ter ao menos 6 caracteres.');
  if (store.where('users', (u) => u.email.toLowerCase() === email).length) return err(res, 409, 'Já existe uma conta com este e-mail.');
  const u = store.insert('users', { nome, email, senha_hash: hashSenha(senha), role, ativo: true });
  res.status(201).json(userView(u));
});
app.put('/api/admin/users/:id', requireAdmin, (req, res) => {
  const u = store.find('users', req.params.id);
  if (!u) return err(res, 404, 'Conta não encontrada.');
  const patch = {};
  if (typeof req.body.nome === 'string' && req.body.nome.trim()) patch.nome = req.body.nome.trim();
  if (typeof req.body.ativo === 'boolean') patch.ativo = req.body.ativo;
  if (req.body.role === 'admin' || req.body.role === 'user') patch.role = req.body.role;
  if (req.body.senha) {
    if (String(req.body.senha).length < 6) return err(res, 400, 'Senha deve ter ao menos 6 caracteres.');
    patch.senha_hash = hashSenha(req.body.senha);
  }
  res.json(userView(store.update('users', u.id, patch)));
});
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const u = store.find('users', req.params.id);
  if (!u) return err(res, 404, 'Conta não encontrada.');
  if (u.id === req.user.id) return err(res, 400, 'Você não pode excluir a própria conta.');
  store.where('sessions', (s) => s.user_id === u.id).forEach((s) => store.remove('sessions', s.id));
  store.remove('users', u.id);
  res.status(204).end();
});

// ================================================================ WHATSAPP
app.get('/api/whatsapp/status', async (_req, res) => {
  res.json(await whatsappStatus());
});

// QR Code para conectar a instância (apenas no provedor Evolution).
app.get('/api/whatsapp/qr', async (_req, res) => {
  if (PROVIDER !== 'evolution') return err(res, 400, 'Conexão por QR disponível apenas com a Evolution API.');
  try {
    const status = await whatsappStatus();
    if (status.conectado) return res.json({ conectado: true });
    const qr = await evolutionConnect();
    res.json({ conectado: false, ...qr });
  } catch (e) { err(res, 502, e.message); }
});

// ================================================================ CLIENTES
app.get('/api/clientes', (req, res) => {
  const q = (req.query.q || '').toString().toLowerCase().trim();
  let list = store.where('clientes', (c) => c.owner_id === req.user.id);
  if (q) list = list.filter((c) => c.nome.toLowerCase().includes(q));
  res.json(list.sort((a, b) => a.nome.localeCompare(b.nome)).map(clienteView));
});

app.get('/api/clientes/:id', (req, res) => {
  const c = store.find('clientes', req.params.id);
  if (!c || c.owner_id !== req.user.id) return err(res, 404, 'Cliente não encontrado.');
  res.json(clienteView(c));
});

function parseCliente(body) {
  const nome = (body.nome || '').trim();
  const telefone = normalizePhoneBR(body.telefone);
  const cnpj = body.cnpj ? onlyDigits(body.cnpj) : null;
  const email = (body.email || '').trim() || null;
  const erros = [];
  if (!isNonEmpty(nome, 160)) erros.push('Nome / Razão Social é obrigatório.');
  if (!telefone) erros.push('Telefone WhatsApp inválido (use DDD + número).');
  if (cnpj && cnpj.length === 14 && !isValidCNPJ(cnpj)) erros.push('CNPJ inválido.');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) erros.push('E-mail inválido.');
  // CNPJ com menos de 14 dígitos pode ser CPF — aceitamos como identificador livre.
  return { data: { nome, telefone, cnpj, email }, erros };
}

app.post('/api/clientes', (req, res) => {
  const { data, erros } = parseCliente(req.body);
  if (erros.length) return err(res, 400, erros.join(' '));
  res.status(201).json(clienteView(store.insert('clientes', { ...data, owner_id: req.user.id })));
});

app.put('/api/clientes/:id', (req, res) => {
  const c = store.find('clientes', req.params.id);
  if (!c || c.owner_id !== req.user.id) return err(res, 404, 'Cliente não encontrado.');
  const { data, erros } = parseCliente(req.body);
  if (erros.length) return err(res, 400, erros.join(' '));
  res.json(clienteView(store.update('clientes', c.id, data)));
});

app.delete('/api/clientes/:id', (req, res) => {
  const c = store.find('clientes', req.params.id);
  if (!c || c.owner_id !== req.user.id) return err(res, 404, 'Cliente não encontrado.');
  if (store.where('documentos', (d) => d.cliente_id === c.id).length)
    return err(res, 409, 'Não é possível excluir: cliente possui documentos vinculados.');
  store.remove('clientes', c.id);
  res.status(204).end();
});

// ============================================= TIPOS (documento / pagamento)
function makeTipoRoutes(path, collection, label) {
  app.get(`/api/${path}`, (_req, res) =>
    res.json(store.all(collection).sort((a, b) => a.descricao.localeCompare(b.descricao)))
  );

  app.post(`/api/${path}`, (req, res) => {
    const descricao = (req.body.descricao || '').trim();
    if (!isNonEmpty(descricao)) return err(res, 400, 'Descrição é obrigatória.');
    if (store.where(collection, (t) => t.descricao.toLowerCase() === descricao.toLowerCase()).length)
      return err(res, 409, `Este ${label} já existe.`);
    res.status(201).json(store.insert(collection, { descricao }));
  });

  app.put(`/api/${path}/:id`, (req, res) => {
    const t = store.find(collection, req.params.id);
    if (!t) return err(res, 404, `${label} não encontrado.`);
    const descricao = (req.body.descricao || '').trim();
    if (!isNonEmpty(descricao)) return err(res, 400, 'Descrição é obrigatória.');
    const dup = store.where(collection, (x) => x.descricao.toLowerCase() === descricao.toLowerCase() && x.id !== t.id);
    if (dup.length) return err(res, 409, `Este ${label} já existe.`);
    res.json(store.update(collection, t.id, { descricao }));
  });

  app.delete(`/api/${path}/:id`, (req, res) => {
    const t = store.find(collection, req.params.id);
    if (!t) return err(res, 404, `${label} não encontrado.`);
    const fk = collection === 'tipos_documento' ? 'tipo_documento_id' : 'tipo_pagamento_id';
    if (store.where('documentos', (d) => d[fk] === t.id).length)
      return err(res, 409, `Não é possível excluir: ${label} em uso por documentos.`);
    store.remove(collection, t.id);
    res.status(204).end();
  });
}
makeTipoRoutes('tipos-documento', 'tipos_documento', 'tipo de documento');
makeTipoRoutes('tipos-pagamento', 'tipos_pagamento', 'tipo de pagamento');

// ============================================================== DOCUMENTOS
app.get('/api/documentos', (req, res) => {
  let list = store.where('documentos', (d) => d.owner_id === req.user.id);
  if (req.query.cliente_id) list = list.filter((d) => d.cliente_id === Number(req.query.cliente_id));
  if (req.query.tipo_documento_id) list = list.filter((d) => d.tipo_documento_id === Number(req.query.tipo_documento_id));
  if (req.query.competencia) list = list.filter((d) => d.competencia === req.query.competencia);
  res.json(list.sort((a, b) => b.id - a.id).map(documentoView));
});

app.get('/api/documentos/:id', (req, res) => {
  const d = store.find('documentos', req.params.id);
  if (!d || d.owner_id !== req.user.id) return err(res, 404, 'Documento não encontrado.');
  res.json(documentoView(d));
});

// Converte "R$ 1.234,56" | "1.234,56" | "1234.56" -> Number (ou null).
function parseValor(v) {
  if (v == null || v === '') return null;
  let s = String(v).replace(/[^\d,.-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); // formato pt-BR
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Campos fiscais da guia a partir do corpo da requisição.
function guiaFields(body) {
  return {
    tipo_documento_id: body.tipo_documento_id ? Number(body.tipo_documento_id) : null,
    tipo_pagamento_id: body.tipo_pagamento_id ? Number(body.tipo_pagamento_id) : null,
    competencia: (body.competencia || '').trim() || null, // "YYYY-MM"
    vencimento: (body.vencimento || '').trim() || null,    // "YYYY-MM-DD"
    valor: parseValor(body.valor),
    situacao: ['aberta', 'paga'].includes(body.situacao) ? body.situacao : 'aberta',
    observacao: (body.observacao || '').trim() || null,
  };
}

app.post('/api/documentos', upload.single('arquivo'), (req, res) => {
  if (!req.file) return err(res, 400, 'Arquivo é obrigatório.');
  const cliente = store.find('clientes', req.body.cliente_id);
  if (!cliente || cliente.owner_id !== req.user.id) {
    unlinkSync(req.file.path);
    return err(res, 400, 'Cliente inválido.');
  }
  const doc = store.insert('documentos', {
    cliente_id: cliente.id,
    owner_id: req.user.id,
    ...guiaFields(req.body),
    nome_arquivo: req.file.originalname,
    caminho_arquivo: req.file.path,
    mime_type: req.file.mimetype,
    tamanho_bytes: req.file.size,
  });
  res.status(201).json(documentoView(doc));
});

// Edita campos da guia (situação, valor, vencimento, competência, tipo) sem re-upload.
app.put('/api/documentos/:id', (req, res) => {
  const d = store.find('documentos', req.params.id);
  if (!d || d.owner_id !== req.user.id) return err(res, 404, 'Guia não encontrada.');
  res.json(documentoView(store.update('documentos', d.id, guiaFields({ ...d, ...req.body }))));
});

// Upload EM LOTE com casamento automático de arquivo -> cliente (por CNPJ ou nome).
app.post('/api/documentos/lote', upload.array('arquivos', 200), (req, res) => {
  if (!req.files || !req.files.length) return err(res, 400, 'Envie ao menos um arquivo.');
  const clientes = store.where('clientes', (c) => c.owner_id === req.user.id);
  const base = guiaFields(req.body); // competência/tipo/vencimento aplicados a todos
  const inseridos = [];
  const nao_casados = [];

  for (const file of req.files) {
    const match = casarCliente(file.originalname, clientes);
    if (match.cliente) {
      const doc = store.insert('documentos', {
        cliente_id: match.cliente.id,
        owner_id: req.user.id,
        ...base,
        nome_arquivo: file.originalname,
        caminho_arquivo: file.path,
        mime_type: file.mimetype,
        tamanho_bytes: file.size,
      });
      inseridos.push({ documento_id: doc.id, arquivo: file.originalname, cliente_nome: match.cliente.nome, por: match.por });
    } else {
      nao_casados.push({ arquivo: file.originalname, caminho: file.path, motivo: match.motivo });
    }
  }
  res.status(201).json({ total: req.files.length, casados: inseridos.length, inseridos, nao_casados });
});

// Associa manualmente um arquivo órfão (não casado no lote) a um cliente.
app.post('/api/documentos/associar', express.json(), (req, res) => {
  const cliente = store.find('clientes', req.body.cliente_id);
  if (!cliente || cliente.owner_id !== req.user.id) return err(res, 400, 'Cliente inválido.');
  const caminho = req.body.caminho || '';
  const resolved = join(UPLOAD_DIR, caminho.split(/[\\/]/).pop() || ''); // só o nome do arquivo, dentro de UPLOAD_DIR
  if (!existsSync(resolved)) return err(res, 404, 'Arquivo não encontrado.');
  const doc = store.insert('documentos', {
    cliente_id: cliente.id,
    owner_id: req.user.id,
    ...guiaFields(req.body),
    nome_arquivo: req.body.nome_arquivo || resolved.split(/[\\/]/).pop(),
    caminho_arquivo: resolved,
    mime_type: req.body.mime_type || null,
    tamanho_bytes: null,
  });
  res.status(201).json(documentoView(doc));
});

const RE_ACENTOS = new RegExp('[\\u0300-\\u036f]', 'g');
const SUFIXOS_SOCIETARIOS = new Set(['ltda', 'me', 'epp', 'eireli', 'sa', 'mei', 'ss', 'ei']);

function normalizarTexto(s) {
  return String(s).normalize('NFD').replace(RE_ACENTOS, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Núcleo do nome: remove sufixos societários (LTDA, ME, EPP…) do fim para casar melhor.
function nucleoNome(nome) {
  const toks = String(nome).normalize('NFD').replace(RE_ACENTOS, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  while (toks.length > 1 && SUFIXOS_SOCIETARIOS.has(toks[toks.length - 1])) toks.pop();
  return toks.join('');
}

// Casa um arquivo a um cliente: 1º por CNPJ (14 dígitos no nome), 2º por núcleo do nome.
function casarCliente(nomeArquivo, clientes) {
  const digitos = onlyDigits(nomeArquivo);
  if (digitos.length >= 14) {
    for (const c of clientes) {
      if (c.cnpj && c.cnpj.length === 14 && digitos.includes(c.cnpj)) return { cliente: c, por: 'cnpj' };
    }
  }
  const alvo = normalizarTexto(nomeArquivo);
  const candidatos = clientes.filter((c) => {
    const nucleo = nucleoNome(c.nome || '');
    return nucleo.length >= 4 && alvo.includes(nucleo);
  });
  if (candidatos.length === 1) return { cliente: candidatos[0], por: 'nome' };
  if (candidatos.length > 1) return { cliente: null, motivo: 'ambíguo (vários clientes no nome)' };
  return { cliente: null, motivo: 'nenhum cliente reconhecido' };
}

app.get('/api/documentos/:id/download', (req, res) => {
  const d = store.find('documentos', req.params.id);
  if (!d || d.owner_id !== req.user.id || !existsSync(d.caminho_arquivo)) return err(res, 404, 'Arquivo não encontrado.');
  res.download(d.caminho_arquivo, d.nome_arquivo);
});

app.delete('/api/documentos/:id', (req, res) => {
  const d = store.find('documentos', req.params.id);
  if (!d || d.owner_id !== req.user.id) return err(res, 404, 'Documento não encontrado.');
  try { if (existsSync(d.caminho_arquivo)) unlinkSync(d.caminho_arquivo); } catch { /* ignore */ }
  store.remove('documentos', d.id);
  res.status(204).end();
});

// ================================================================= ENVIOS
const TEMPLATE_PADRAO =
  'Olá {{nome}}, tudo bem?\nSeguem os documentos referentes à competência {{competencia}}:\n\n{{lista}}\n\nOs arquivos estão anexados nesta mensagem em PDF. Qualquer dúvida, estamos à disposição.\n\nAtenciosamente,\nEscritório Contábil';

function fmtValorBR(v) {
  return typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null;
}
function fmtCompetenciaBR(c) {
  return c && /^\d{4}-\d{2}$/.test(c) ? `${c.slice(5)}/${c.slice(0, 4)}` : (c || '');
}
function fmtDataBR(d) {
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : (d || '');
}

// Monta uma linha rica por guia: "• DAS — vence 20/08/2026 — R$ 150,00"
function linhaGuia(d) {
  const partes = [`*${d.tipo_documento || 'Documento'}*`];
  if (d.vencimento) partes.push(`vence ${fmtDataBR(d.vencimento)}`);
  const val = fmtValorBR(d.valor);
  if (val) partes.push(val);
  return `• ${partes.join(' — ')}`;
}

function montarMensagem(template, cliente, docs) {
  const lista = docs.map(linhaGuia).join('\n');
  const competencia = fmtCompetenciaBR(docs.find((d) => d.competencia)?.competencia) || 'informada';
  return (template || TEMPLATE_PADRAO)
    .replaceAll('{{nome}}', cliente.nome)
    .replaceAll('{{competencia}}', competencia)
    .replaceAll('{{lista}}', lista);
}

app.get('/api/envios', (req, res) => {
  let list = store.where('envios', (e) => e.owner_id === req.user.id);
  if (req.query.cliente_id) list = list.filter((e) => e.cliente_id === Number(req.query.cliente_id));
  if (req.query.status) list = list.filter((e) => e.status === req.query.status);
  const view = list.sort((a, b) => b.id - a.id).slice(0, Number(req.query.limit) || 100).map((e) => {
    const c = store.find('clientes', e.cliente_id);
    const d = store.find('documentos', e.documento_id);
    return { ...e, cliente_nome: c?.nome ?? '—', documento_nome: d?.nome_arquivo ?? '—' };
  });
  res.json(view);
});

// Envia os boletos (docs) de um aluno por WhatsApp. Retorna lista de resultados.
async function enviarBoletosDeAluno(aluno, docs, template) {
  const texto = montarMensagem(template, aluno, docs);
  const resultados = [];
  for (const doc of docs) {
    const registro = store.insert('envios', {
      documento_id: doc.id,
      cliente_id: aluno.id,
      owner_id: aluno.owner_id,
      status: 'pendente',
      mensagem: texto,
      wa_link: buildWaLink(aluno.telefone, texto),
      provider: PROVIDER,
    });
    const r = await enviarWhatsApp({
      telefone: aluno.telefone,
      texto,
      documento: { caminho: doc.caminho_arquivo, nome_arquivo: doc.nome_arquivo, mime_type: doc.mime_type },
    });
    const atualizado = store.update('envios', registro.id, {
      status: r.status,
      erro: r.erro || null,
      provider_message_id: r.providerMessageId || null,
      provider: r.provider,
    });
    resultados.push({ ...atualizado, aluno_nome: aluno.nome, documento_nome: doc.nome_arquivo });
  }
  return resultados;
}

// Envio de mensagem simples (sem anexo).
async function enviarTextoCliente(cliente, template) {
  const texto = montarMensagem(template, cliente, []);
  const registro = store.insert('envios', {
    documento_id: null, cliente_id: cliente.id, owner_id: cliente.owner_id, status: 'pendente',
    mensagem: texto, wa_link: buildWaLink(cliente.telefone, texto), provider: PROVIDER,
  });
  const r = await enviarWhatsApp({ telefone: cliente.telefone, texto });
  const atualizado = store.update('envios', registro.id, {
    status: r.status, erro: r.erro || null, provider_message_id: r.providerMessageId || null, provider: r.provider,
  });
  return [{ ...atualizado, aluno_nome: cliente.nome, documento_nome: '(mensagem)' }];
}

// Envio INDIVIDUAL: um cliente + guias escolhidas (ou só mensagem, se sem guias).
app.post('/api/enviar', async (req, res) => {
  const cliente = store.find('clientes', req.body.cliente_id);
  if (!cliente || cliente.owner_id !== req.user.id) return err(res, 400, 'Cliente inválido.');
  if (!cliente.telefone) return err(res, 422, 'Cliente sem telefone WhatsApp cadastrado.');

  const ids = Array.isArray(req.body.documento_ids) ? req.body.documento_ids : [];
  const docs = ids.map((id) => store.find('documentos', id)).filter((d) => d && d.owner_id === req.user.id).map(documentoView);

  let resultados;
  if (docs.length) {
    resultados = await enviarBoletosDeAluno(cliente, docs, req.body.mensagem);
  } else if ((req.body.mensagem || '').trim()) {
    resultados = await enviarTextoCliente(cliente, req.body.mensagem); // envio só de texto
  } else {
    return err(res, 400, 'Anexe uma guia ou escreva uma mensagem.');
  }
  const ok = resultados.filter((r) => r.status === 'enviado').length;
  res.json({ provider: PROVIDER, total: resultados.length, enviados: ok, falhas: resultados.length - ok, resultados });
});

// Envio EM MASSA: vários clientes. modo = 'ultimo' | 'todos'. competencia (opcional) filtra as guias.
app.post('/api/enviar-massa', async (req, res) => {
  const clienteIds = Array.isArray(req.body.aluno_ids) ? req.body.aluno_ids : [];
  const modo = req.body.modo === 'todos' ? 'todos' : 'ultimo';
  const competencia = (req.body.competencia || '').trim() || null;
  if (!clienteIds.length) return err(res, 400, 'Selecione ao menos um cliente.');

  const resultados = [];
  const ignorados = []; // clientes sem guia ou sem telefone

  for (const id of clienteIds) {
    const cliente = store.find('clientes', id);
    if (!cliente || cliente.owner_id !== req.user.id) continue;
    if (!cliente.telefone) { ignorados.push({ aluno_nome: cliente.nome, motivo: 'sem telefone' }); continue; }

    let docs = store.where('documentos', (d) => d.cliente_id === cliente.id).sort((a, b) => b.id - a.id);
    if (competencia) docs = docs.filter((d) => d.competencia === competencia);
    if (!docs.length) { ignorados.push({ aluno_nome: cliente.nome, motivo: competencia ? 'sem guia na competência' : 'sem guia' }); continue; }
    // Com competência, envia todas as guias daquela competência; senão respeita o modo.
    if (!competencia && modo === 'ultimo') docs = [docs[0]];
    docs = docs.map(documentoView);

    const r = await enviarBoletosDeAluno(cliente, docs, req.body.mensagem);
    resultados.push(...r);
  }

  const ok = resultados.filter((r) => r.status === 'enviado').length;
  res.json({
    provider: PROVIDER,
    alunos: clienteIds.length,
    total: resultados.length,
    enviados: ok,
    falhas: resultados.length - ok,
    ignorados,
    resultados,
  });
});

// ============================================================== DASHBOARD
app.get('/api/dashboard', (req, res) => {
  const envios = store.where('envios', (e) => e.owner_id === req.user.id);
  res.json({
    clientes: store.where('clientes', (c) => c.owner_id === req.user.id).length,
    documentos: store.where('documentos', (d) => d.owner_id === req.user.id).length,
    envios_total: envios.length,
    envios_enviados: envios.filter((e) => e.status === 'enviado').length,
    envios_falha: envios.filter((e) => e.status === 'falha').length,
    provider: PROVIDER,
    ultimos_envios: envios.sort((a, b) => b.id - a.id).slice(0, 6).map((e) => {
      const c = store.find('clientes', e.cliente_id);
      const d = store.find('documentos', e.documento_id);
      return { id: e.id, cliente_nome: c?.nome ?? '—', documento_nome: d?.nome_arquivo ?? '—', status: e.status, criado_em: e.criado_em };
    }),
  });
});

// --------------------------------------------------------- error handler
app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE')
    return err(res, 413, 'Arquivo excede o limite de 20 MB.');
  return err(res, 400, error.message || 'Erro inesperado.');
});

seedIfEmpty();
seedAdmin();
app.listen(PORT, () => {
  console.log(`\n  Sistema de Envio de Documentos por WhatsApp`);
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  → Provedor de WhatsApp: ${PROVIDER.toUpperCase()}${PROVIDER === 'mock' ? ' (simulação)' : ''}`);
  console.log(`  → Login em /login.html\n`);
});
