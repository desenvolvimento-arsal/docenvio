// Roteamento SPA + telas.
const view = document.getElementById('view');
const CRUMB = document.getElementById('crumb');

const ROUTES = {
  rapido: { title: 'Envio Rápido', render: renderEnvioRapido },
  dashboard: { title: 'Dashboard', render: renderDashboard },
  envio: { title: 'Envio de Guias', render: renderEnvio },
  agendamentos: { title: 'Agendamentos', render: renderAgendamentos },
  clientes: { title: 'Clientes', render: renderClientes },
  documentos: { title: 'Guias & Boletos', render: renderDocumentos },
  whatsapp: { title: 'Conexão WhatsApp', render: renderWhatsapp },
  'tipos-documento': { title: 'Tipos de Guia', render: () => renderTipos('tipos-documento', 'Tipo de Guia') },
  'tipos-pagamento': { title: 'Formas de Pagamento', render: () => renderTipos('tipos-pagamento', 'Forma de Pagamento') },
  admin: { title: 'Contas', render: renderAdmin },
};

// ---- agendamento: bloco reutilizável nos fluxos de envio ----
function schedBlock(prefix) {
  return `<div style="margin:4px 0 12px">
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;cursor:pointer;color:var(--text-2)">
      <input type="checkbox" id="${prefix}-agchk" style="width:16px;height:16px;accent-color:var(--primary)"> ${icon('clock')} Agendar para depois
    </label>
    <input type="datetime-local" id="${prefix}-agdt" class="filter" style="width:100%;margin-top:8px;display:none">
  </div>`;
}
// Liga o bloco; atualiza o label do botão. Retorna helpers { agendado, quando, valido }.
function wireSched(prefix, root, btn, labelNormal) {
  const chk = root.querySelector('#' + prefix + '-agchk');
  const dt = root.querySelector('#' + prefix + '-agdt');
  if (chk) chk.onchange = () => {
    dt.style.display = chk.checked ? 'block' : 'none';
    if (btn) btn.innerHTML = chk.checked ? `${icon('clock')} Agendar envio` : labelNormal;
  };
  return {
    agendado: () => chk && chk.checked,
    valido: () => dt.value && new Date(dt.value).getTime() > Date.now(),
    quando: () => new Date(dt.value).toISOString(),
  };
}

// ---- helpers de formatação (compartilhados) ----
const FMT = {
  valor: (v) => (typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'),
  competencia: (c) => (c && /^\d{4}-\d{2}$/.test(c) ? `${c.slice(5)}/${c.slice(0, 4)}` : '—'),
  data: (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—'),
};

function navigate(route) {
  if (!ROUTES[route]) route = 'dashboard';
  location.hash = route;
}

async function router() {
  if (window._waPoll) { clearInterval(window._waPoll); window._waPoll = null; } // para polling do QR ao sair
  if (window._agPoll) { clearInterval(window._agPoll); window._agPoll = null; }
  if (window._lotePoll) { clearInterval(window._lotePoll); window._lotePoll = null; }
  const hash = location.hash.replace('#', '') || 'rapido';
  view.innerHTML = '<div class="empty">Carregando…</div>';

  // Rota com parâmetro: detalhe do cliente (#cliente/<id>)
  if (hash.startsWith('cliente/')) {
    const id = hash.split('/')[1];
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.route === 'clientes'));
    CRUMB.textContent = 'Cliente';
    try { await renderClienteDetalhe(id); } catch (e) { view.innerHTML = UI.emptyState('alert', e.message); }
    return;
  }

  const def = ROUTES[hash] || ROUTES.dashboard;
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.route === hash));
  CRUMB.textContent = def.title;
  try { await def.render(); } catch (e) { view.innerHTML = UI.emptyState('alert', e.message); }
}

// ====================================================== WHATSAPP STATUS
async function refreshWaStatus() {
  const box = document.getElementById('waStatus');
  try {
    const s = await API.get('/whatsapp/status');
    const cls = s.provider === 'mock' ? 'off' : s.conectado ? 'ok' : 'err';
    const label = s.provider === 'mock'
      ? 'WhatsApp: modo simulação'
      : s.conectado ? `WhatsApp conectado (${s.instancia})` : `WhatsApp ${s.estado}`;
    box.className = `wa-status ${cls}`;
    box.innerHTML = `<span class="dot"></span> <span>${UI.esc(label)}</span>`;
  } catch {
    box.className = 'wa-status err';
    box.innerHTML = '<span class="dot"></span> <span>Status indisponível</span>';
  }
}

// ============================================================ DASHBOARD
async function renderDashboard() {
  const d = await API.get('/dashboard');
  const kpi = (ico, cls, label, value) => `
    <div class="card kpi"><div class="kpi-ico ${cls}">${icon(ico)}</div>
      <div><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div></div></div>`;

  const ultimos = d.ultimos_envios.length
    ? `<ul class="list-mini">${d.ultimos_envios.map((e) => `
        <li><div><div class="l-main">${UI.esc(e.cliente_nome)}</div>
        <div class="l-sub">${UI.esc(e.documento_nome)} · ${UI.fmtDate(e.criado_em)}</div></div>
        ${UI.badge(e.status)}</li>`).join('')}</ul>`
    : UI.emptyState('inbox', 'Nenhum envio realizado ainda.');

  const provTag = d.provider === 'mock'
    ? '<span class="provider-tag mock">Simulação</span>'
    : '<span class="provider-tag">Evolution API</span>';

  view.innerHTML = `
    <div class="page-head"><div><h1>Dashboard</h1><p>Visão geral do sistema · Provedor: ${provTag}</p></div></div>
    <div class="kpi-grid">
      ${kpi('users', 'blue', 'Clientes', d.clientes)}
      ${kpi('folder', 'blue', 'Guias', d.documentos)}
      ${kpi('check', 'green', 'Guias enviadas', d.envios_enviados)}
      ${kpi('alert', 'red', 'Envios com falha', d.envios_falha)}
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-pad"><h3>Últimos envios</h3></div>
        <div class="card-pad" style="padding-top:0">${ultimos}</div></div>
      <div class="card card-pad"><h3 style="margin-bottom:14px">Ações rápidas</h3>
        <div class="quick-actions">
          <button class="btn success block" onclick="navigate('envio')">${icon('send')} Enviar guias do mês</button>
          <button class="btn secondary block" onclick="navigate('clientes')">${icon('users')} Cadastrar cliente</button>
          <button class="btn secondary block" onclick="navigate('documentos')">${icon('upload')} Importar guias</button>
        </div>
      </div>
    </div>`;
}

// ============================================================= CLIENTES
async function renderClientes() {
  view.innerHTML = `
    <div class="page-head"><div><h1>Clientes</h1><p>Empresas atendidas pelo escritório</p></div>
      <button class="btn" id="novo">${icon('plus')} Novo Cliente</button></div>
    <div class="toolbar">
      <div class="search">${icon('search')}<input id="busca" placeholder="Buscar por nome…" /></div>
    </div>
    <div id="tabela"></div>`;

  const load = async (q = '') => {
    const list = await API.get(`/clientes${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    document.getElementById('tabela').innerHTML = list.length ? `
      <div class="table-wrap"><table><thead><tr>
        <th>Razão Social / Nome</th><th>CNPJ/CPF</th><th>WhatsApp</th><th>Guias</th><th></th>
      </tr></thead><tbody>${list.map((c) => `
        <tr>
          <td><a class="rowlink" href="#cliente/${c.id}"><b>${UI.esc(c.nome)}</b></a>${c.email ? `<div class="l-sub muted">${UI.esc(c.email)}</div>` : ''}</td>
          <td class="mono muted">${c.cnpj_formatado || '—'}</td>
          <td class="mono">${UI.esc(c.telefone)}</td>
          <td><a class="rowlink muted" href="#cliente/${c.id}">${c.documentos_count}</a></td>
          <td class="actions">
            <a class="icon-btn" href="#cliente/${c.id}" title="Abrir ficha">${icon('grid')}</a>
            <button class="icon-btn" data-edit="${c.id}" title="Editar">${icon('edit')}</button>
            <button class="icon-btn danger" data-del="${c.id}" title="Excluir">${icon('trash')}</button>
          </td>
        </tr>`).join('')}</tbody></table></div>`
      : UI.emptyState('users', 'Nenhum cliente cadastrado.', '<button class="btn" onclick="document.getElementById(\'novo\').click()">Cadastrar cliente</button>');

    document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => formCliente(list.find((c) => c.id == b.dataset.edit)));
    document.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => delCliente(list.find((c) => c.id == b.dataset.del)));
  };

  document.getElementById('novo').onclick = () => formCliente();
  let t;
  document.getElementById('busca').oninput = (e) => { clearTimeout(t); t = setTimeout(() => load(e.target.value), 250); };
  await load();

  window._reloadClientes = load;
}

function formCliente(cliente = null) {
  const m = UI.modal({
    title: cliente ? 'Editar Cliente' : 'Novo Cliente',
    body: `
      <div class="field" data-f="nome"><label>Razão Social / Nome</label>
        <input id="f-nome" value="${cliente ? UI.esc(cliente.nome) : ''}" placeholder="Ex: Comércio Silva Ltda" />
        <div class="msg-error">Informe o nome.</div></div>
      <div class="field" data-f="cnpj"><label>CNPJ / CPF <span class="opt">(opcional)</span></label>
        <input id="f-cnpj" value="${cliente && cliente.cnpj_formatado ? cliente.cnpj_formatado : ''}" placeholder="00.000.000/0000-00" inputmode="numeric" />
        <div class="hint">Usado no casamento automático da importação em lote.</div>
        <div class="msg-error">CNPJ inválido.</div></div>
      <div class="field" data-f="telefone"><label>Telefone WhatsApp</label>
        <input id="f-tel" value="${cliente ? UI.esc(cliente.telefone) : ''}" placeholder="(11) 99999-9999" inputmode="numeric" />
        <div class="hint">DDD + número. Ex: (11) 99999-9999</div>
        <div class="msg-error">Telefone inválido.</div></div>
      <div class="field" data-f="email"><label>E-mail <span class="opt">(opcional — canal de backup)</span></label>
        <input id="f-email" value="${cliente && cliente.email ? UI.esc(cliente.email) : ''}" placeholder="cliente@empresa.com" />
        <div class="msg-error">E-mail inválido.</div></div>`,
    footer: `<button class="btn secondary" data-close>Cancelar</button><button class="btn" id="salvar">${icon('check')} Salvar</button>`,
  });
  UI.bindMask(m.el.querySelector('#f-cnpj'), UI.maskCNPJ);
  UI.bindMask(m.el.querySelector('#f-tel'), UI.maskPhone);

  m.el.querySelector('#salvar').onclick = async () => {
    const payload = {
      nome: m.el.querySelector('#f-nome').value,
      cnpj: m.el.querySelector('#f-cnpj').value,
      telefone: m.el.querySelector('#f-tel').value,
      email: m.el.querySelector('#f-email').value,
    };
    try {
      if (cliente) await API.put(`/clientes/${cliente.id}`, payload);
      else await API.post('/clientes', payload);
      m.close();
      UI.toast('success', cliente ? 'Cliente atualizado' : 'Cliente cadastrado');
      window._reloadClientes();
    } catch (e) { UI.toast('error', 'Não foi possível salvar', e.message); }
  };
}

async function delCliente(c) {
  const ok = await UI.confirm({ title: 'Excluir cliente', message: `Excluir "${c.nome}"? Esta ação não pode ser desfeita.` });
  if (!ok) return;
  try { await API.del(`/clientes/${c.id}`); UI.toast('success', 'Cliente excluído'); window._reloadClientes(); }
  catch (e) { UI.toast('error', 'Não foi possível excluir', e.message); }
}

// ---------- Ficha do cliente (visão 360°) ----------
async function renderClienteDetalhe(id) {
  const [cliente, docs, tiposDoc] = await Promise.all([
    API.get('/clientes/' + id),
    API.get('/documentos?cliente_id=' + id),
    API.get('/tipos-documento'),
  ]);
  let envios = [];
  try { envios = await API.get('/envios?cliente_id=' + id); } catch { envios = []; }
  CRUMB.textContent = cliente.nome;

  const abertas = docs.filter((d) => d.situacao !== 'paga');
  const vencidas = docs.filter((d) => d.situacao === 'vencida').length;
  const aVencer = abertas.reduce((s, d) => s + (typeof d.valor === 'number' ? d.valor : 0), 0);
  const recarregar = () => renderClienteDetalhe(id);

  view.innerHTML = `
    <a class="back" href="#clientes">← Voltar para Clientes</a>
    <div class="detail-head card">
      <div class="dh-left">
        <div class="dh-av">${UI.initials(cliente.nome)}</div>
        <div>
          <h1>${UI.esc(cliente.nome)}</h1>
          <div class="dh-meta">
            ${cliente.cnpj_formatado ? `<span>${icon('building')} ${cliente.cnpj_formatado}</span>` : ''}
            <span>${icon('send')} ${UI.esc(cliente.telefone)}</span>
            ${cliente.email ? `<span>${icon('inbox')} ${UI.esc(cliente.email)}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="dh-actions">
        <button class="btn secondary" id="d-edit">${icon('edit')} Editar</button>
        <button class="btn success" id="d-enviar" ${docs.length ? '' : 'disabled'}>${icon('send')} Enviar guias</button>
      </div>
    </div>
    <div class="kpi-inline">
      <div><span class="ki-v">${docs.length}</span><span class="ki-l">Guias</span></div>
      <div><span class="ki-v">${abertas.length}</span><span class="ki-l">Em aberto</span></div>
      <div><span class="ki-v" style="color:var(--danger)">${vencidas}</span><span class="ki-l">Vencidas</span></div>
      <div><span class="ki-v">${FMT.valor(aVencer)}</span><span class="ki-l">A vencer</span></div>
    </div>
    <div class="tabs" id="tabs">
      <button class="tab active" data-tab="guias">Guias (${docs.length})</button>
      <button class="tab" data-tab="envios">Envios (${envios.length})</button>
    </div>
    <div id="tab-guias"></div>
    <div id="tab-envios" hidden></div>`;

  const gtab = view.querySelector('#tab-guias');
  gtab.innerHTML = `
    <div class="toolbar" style="justify-content:flex-end"><button class="btn" id="d-nova">${icon('upload')} Nova guia</button></div>
    ${docs.length ? `<div class="table-wrap"><table><thead><tr>
      <th>Arquivo</th><th>Tipo</th><th>Competência</th><th>Vencimento</th><th>Valor</th><th>Situação</th><th>Envio</th><th></th>
    </tr></thead><tbody>${docs.map((d) => `
      <tr><td><b>${UI.esc(d.nome_arquivo)}</b></td><td class="muted">${d.tipo_documento || '—'}</td>
      <td class="mono muted">${FMT.competencia(d.competencia)}</td><td class="mono muted">${FMT.data(d.vencimento)}</td>
      <td class="mono">${FMT.valor(d.valor)}</td><td>${UI.badge(d.situacao)}</td><td>${UI.badge(d.status_envio)}</td>
      <td class="actions"><a class="icon-btn" href="/api/documentos/${d.id}/download" title="Baixar">${icon('download')}</a></td></tr>`).join('')}</tbody></table></div>`
    : UI.emptyState('folder', 'Nenhuma guia para este cliente.')}`;
  gtab.querySelector('#d-nova').onclick = () => formDocumento([cliente], tiposDoc, recarregar);

  view.querySelector('#tab-envios').innerHTML = envios.length ? `
    <div class="table-wrap"><table><thead><tr><th>Data</th><th>Documento</th><th>Mensagem</th><th>Status</th></tr></thead>
    <tbody>${envios.map((e) => `
      <tr><td class="muted">${UI.fmtDate(e.criado_em)}</td><td>${UI.esc(e.documento_nome || '—')}</td>
      <td class="muted" style="max-width:360px">${UI.esc((e.mensagem || '').slice(0, 90))}${(e.mensagem || '').length > 90 ? '…' : ''}</td>
      <td>${UI.badge(e.status)}</td></tr>`).join('')}</tbody></table></div>`
    : UI.emptyState('inbox', 'Nenhum envio para este cliente ainda.');

  view.querySelectorAll('#tabs .tab').forEach((t) => t.onclick = () => {
    view.querySelectorAll('#tabs .tab').forEach((x) => x.classList.toggle('active', x === t));
    view.querySelector('#tab-guias').hidden = t.dataset.tab !== 'guias';
    view.querySelector('#tab-envios').hidden = t.dataset.tab !== 'envios';
  });

  view.querySelector('#d-edit').onclick = () => { window._reloadClientes = recarregar; formCliente(cliente); };
  view.querySelector('#d-enviar').onclick = () => { window._preselectCliente = String(cliente.id); navigate('envio'); };
}

// ======================================================== TIPOS (genérico)
async function renderTipos(path, label) {
  view.innerHTML = `
    <div class="page-head"><div><h1>${label}s</h1><p>Cadastro auxiliar de ${label.toLowerCase()}</p></div>
      <button class="btn" id="novo">${icon('plus')} Novo</button></div>
    <div id="tabela"></div>`;

  const load = async () => {
    const list = await API.get(`/${path}`);
    document.getElementById('tabela').innerHTML = list.length ? `
      <div class="table-wrap"><table><thead><tr><th>Descrição</th><th>Cadastrado em</th><th></th></tr></thead>
      <tbody>${list.map((t) => `
        <tr><td><b>${UI.esc(t.descricao)}</b></td><td class="muted">${UI.fmtDate(t.criado_em)}</td>
        <td class="actions">
          <button class="icon-btn" data-edit="${t.id}">${icon('edit')}</button>
          <button class="icon-btn danger" data-del="${t.id}">${icon('trash')}</button>
        </td></tr>`).join('')}</tbody></table></div>`
      : UI.emptyState('tag', `Nenhum ${label.toLowerCase()} cadastrado.`);
    document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => form(list.find((t) => t.id == b.dataset.edit)));
    document.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => remove(list.find((t) => t.id == b.dataset.del)));
  };

  const form = (item = null) => {
    const m = UI.modal({
      title: item ? `Editar ${label}` : `Novo ${label}`,
      body: `<div class="field"><label>Descrição</label>
        <input id="f-desc" value="${item ? UI.esc(item.descricao) : ''}" placeholder="Ex: ${path.includes('pagamento') ? 'Boleto, PIX…' : 'DAS, DARF, FGTS…'}" /></div>`,
      footer: `<button class="btn secondary" data-close>Cancelar</button><button class="btn" id="salvar">${icon('check')} Salvar</button>`,
    });
    m.el.querySelector('#f-desc').focus();
    m.el.querySelector('#salvar').onclick = async () => {
      const descricao = m.el.querySelector('#f-desc').value;
      try {
        if (item) await API.put(`/${path}/${item.id}`, { descricao });
        else await API.post(`/${path}`, { descricao });
        m.close(); UI.toast('success', 'Salvo com sucesso'); load();
      } catch (e) { UI.toast('error', 'Não foi possível salvar', e.message); }
    };
  };
  const remove = async (item) => {
    const ok = await UI.confirm({ title: `Excluir ${label.toLowerCase()}`, message: `Excluir "${item.descricao}"?` });
    if (!ok) return;
    try { await API.del(`/${path}/${item.id}`); UI.toast('success', 'Excluído'); load(); }
    catch (e) { UI.toast('error', 'Não foi possível excluir', e.message); }
  };

  document.getElementById('novo').onclick = () => form();
  await load();
}

// =========================================================== GUIAS
async function renderDocumentos() {
  const [clientes, tiposDoc] = await Promise.all([API.get('/clientes'), API.get('/tipos-documento')]);
  view.innerHTML = `
    <div class="page-head"><div><h1>Guias & Boletos</h1><p>Documentos fiscais vinculados a cada cliente</p></div>
      <div style="display:flex;gap:10px">
        <button class="btn secondary" id="lote">${icon('inbox')} Importar em lote</button>
        <button class="btn" id="novo">${icon('upload')} Nova Guia</button>
      </div></div>
    <div class="toolbar">
      <select class="filter" id="fcliente"><option value="">Todos os clientes</option>
        ${clientes.map((c) => `<option value="${c.id}">${UI.esc(c.nome)}</option>`).join('')}</select>
    </div>
    <div id="tabela"></div>`;

  const load = async () => {
    const cid = document.getElementById('fcliente').value;
    const list = await API.get(`/documentos${cid ? `?cliente_id=${cid}` : ''}`);
    document.getElementById('tabela').innerHTML = list.length ? `
      <div class="table-wrap"><table><thead><tr>
        <th>Arquivo</th><th>Cliente</th><th>Tipo</th><th>Competência</th><th>Vencimento</th><th>Valor</th><th>Situação</th><th>Envio</th><th></th>
      </tr></thead><tbody>${list.map((d) => `
        <tr>
          <td><b>${UI.esc(d.nome_arquivo)}</b><div class="l-sub muted">${UI.fmtSize(d.tamanho_bytes)}</div></td>
          <td>${UI.esc(d.cliente_nome)}</td>
          <td class="muted">${d.tipo_documento ? UI.esc(d.tipo_documento) : '—'}</td>
          <td class="mono muted">${FMT.competencia(d.competencia)}</td>
          <td class="mono muted">${FMT.data(d.vencimento)}</td>
          <td class="mono">${FMT.valor(d.valor)}</td>
          <td>${UI.badge(d.situacao)}</td>
          <td>${UI.badge(d.status_envio)}</td>
          <td class="actions">
            <button class="icon-btn" data-edit="${d.id}" title="Editar">${icon('edit')}</button>
            <a class="icon-btn" href="/api/documentos/${d.id}/download" title="Baixar">${icon('download')}</a>
            <button class="icon-btn danger" data-del="${d.id}" title="Excluir">${icon('trash')}</button>
          </td>
        </tr>`).join('')}</tbody></table></div>`
      : UI.emptyState('folder', 'Nenhuma guia cadastrada.', '<button class="btn" onclick="document.getElementById(\'lote\').click()">Importar em lote</button>');
    document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => formDocumento(clientes, tiposDoc, load, list.find((x) => x.id == b.dataset.edit)));
    document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      const doc = list.find((x) => x.id == b.dataset.del);
      const ok = await UI.confirm({ title: 'Excluir guia', message: `Excluir "${doc.nome_arquivo}"?` });
      if (!ok) return;
      try { await API.del(`/documentos/${doc.id}`); UI.toast('success', 'Guia excluída'); load(); }
      catch (e) { UI.toast('error', 'Erro', e.message); }
    });
  };

  document.getElementById('fcliente').onchange = load;
  document.getElementById('novo').onclick = () => formDocumento(clientes, tiposDoc, load);
  document.getElementById('lote').onclick = () => formLote(clientes, tiposDoc, load);
  await load();
}

// Campos fiscais reutilizados no form (single e edição).
function camposFiscais(d = {}, tiposDoc = [], tiposPag = []) {
  return `
    <div class="form-row">
      <div class="field"><label>Tipo de Guia</label>
        <select id="d-tipo"><option value="">—</option>${tiposDoc.map((t) => `<option value="${t.id}" ${d.tipo_documento_id == t.id ? 'selected' : ''}>${UI.esc(t.descricao)}</option>`).join('')}</select></div>
      <div class="field"><label>Competência</label>
        <input type="month" id="d-comp" value="${d.competencia || ''}" /></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Vencimento</label>
        <input type="date" id="d-venc" value="${d.vencimento || ''}" /></div>
      <div class="field"><label>Valor (R$)</label>
        <input id="d-valor" inputmode="numeric" placeholder="0,00" value="${typeof d.valor === 'number' ? d.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : ''}" /></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Forma de Pagamento <span class="opt">(opcional)</span></label>
        <select id="d-pag"><option value="">—</option>${tiposPag.map((t) => `<option value="${t.id}" ${d.tipo_pagamento_id == t.id ? 'selected' : ''}>${UI.esc(t.descricao)}</option>`).join('')}</select></div>
      <div class="field"><label>Situação</label>
        <select id="d-sit"><option value="aberta" ${d.situacao === 'aberta' ? 'selected' : ''}>Em aberto</option>
          <option value="paga" ${d.situacao === 'paga' ? 'selected' : ''}>Paga</option></select></div>
    </div>`;
}

function coletarFiscais(m, fd) {
  const set = (k, v) => (fd instanceof FormData ? fd.append(k, v) : (fd[k] = v));
  set('tipo_documento_id', m.el.querySelector('#d-tipo').value);
  set('tipo_pagamento_id', m.el.querySelector('#d-pag').value);
  set('competencia', m.el.querySelector('#d-comp').value);
  set('vencimento', m.el.querySelector('#d-venc').value);
  set('valor', m.el.querySelector('#d-valor').value);
  set('situacao', m.el.querySelector('#d-sit').value);
  return fd;
}

async function formDocumento(clientes, tiposDoc, onDone, doc = null) {
  const tiposPag = await API.get('/tipos-pagamento');
  if (!clientes.length) return UI.toast('warning', 'Cadastre um cliente primeiro');
  const editando = !!doc;

  const m = UI.modal({
    wide: true,
    title: editando ? 'Editar Guia' : 'Nova Guia',
    body: `
      <div class="field"><label>Cliente</label>
        <select id="d-cliente" ${editando ? 'disabled' : ''}>${clientes.map((c) => `<option value="${c.id}" ${doc && doc.cliente_id == c.id ? 'selected' : ''}>${UI.esc(c.nome)}</option>`).join('')}</select></div>
      ${camposFiscais(doc || {}, tiposDoc, tiposPag)}
      ${editando ? '' : `<div class="field"><label>Arquivo da Guia</label>
        <div class="dropzone" id="dz">${icon('upload')}<div>Clique ou arraste o arquivo aqui</div>
          <div class="hint" style="margin-top:4px">Qualquer formato (PDF recomendado) · até 20 MB</div></div>
        <input type="file" id="d-file" hidden />
        <div id="d-chip"></div>
      </div>`}`,
    footer: `<button class="btn secondary" data-close>Cancelar</button><button class="btn" id="salvar" ${editando ? '' : 'disabled'}>${icon('check')} ${editando ? 'Salvar' : 'Anexar'}</button>`,
  });
  UI.bindMask(m.el.querySelector('#d-valor'), UI.maskMoney);
  const salvar = m.el.querySelector('#salvar');

  if (editando) {
    salvar.onclick = async () => {
      salvar.disabled = true;
      try {
        await API.put(`/documentos/${doc.id}`, coletarFiscais(m, {}));
        m.close(); UI.toast('success', 'Guia atualizada'); onDone();
      } catch (e) { UI.toast('error', 'Erro ao salvar', e.message); salvar.disabled = false; }
    };
    return;
  }

  const fileInput = m.el.querySelector('#d-file');
  const dz = m.el.querySelector('#dz');
  const chip = m.el.querySelector('#d-chip');
  let file = null;
  const setFile = (f) => {
    file = f;
    if (f) {
      chip.innerHTML = `<div class="file-chip">${icon('file')}<div><div class="name">${UI.esc(f.name)}</div><div class="size">${UI.fmtSize(f.size)}</div></div><button class="icon-btn" id="rm">${icon('x')}</button></div>`;
      chip.querySelector('#rm').onclick = () => { setFile(null); fileInput.value = ''; };
      salvar.disabled = false;
    } else { chip.innerHTML = ''; salvar.disabled = true; }
  };
  dz.onclick = () => fileInput.click();
  fileInput.onchange = () => setFile(fileInput.files[0]);
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('drag'); };
  dz.ondragleave = () => dz.classList.remove('drag');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('drag'); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); };

  salvar.onclick = async () => {
    if (!file) return;
    const fd = new FormData();
    fd.append('arquivo', file);
    fd.append('cliente_id', m.el.querySelector('#d-cliente').value);
    coletarFiscais(m, fd);
    salvar.disabled = true; salvar.innerHTML = `${icon('spinner', 'spin')} Enviando…`;
    try {
      await API.upload('/documentos', fd);
      m.close(); UI.toast('success', 'Guia anexada'); onDone();
    } catch (e) {
      UI.toast('error', 'Falha no upload', e.message);
      salvar.disabled = false; salvar.innerHTML = `${icon('check')} Anexar`;
    }
  };
}

// Importação EM LOTE — casa arquivos aos clientes por CNPJ/nome.
async function formLote(clientes, tiposDoc, onDone) {
  if (!clientes.length) return UI.toast('warning', 'Cadastre clientes primeiro');
  const m = UI.modal({
    wide: true,
    title: 'Importar guias em lote',
    body: `
      <div class="form-row">
        <div class="field"><label>Tipo de Guia <span class="opt">(aplica a todos)</span></label>
          <select id="l-tipo"><option value="">—</option>${tiposDoc.map((t) => `<option value="${t.id}">${UI.esc(t.descricao)}</option>`).join('')}</select></div>
        <div class="field"><label>Competência <span class="opt">(aplica a todos)</span></label>
          <input type="month" id="l-comp" /></div>
      </div>
      <div class="field"><label>Vencimento <span class="opt">(opcional, aplica a todos)</span></label>
        <input type="date" id="l-venc" /></div>
      <div class="field"><label>Arquivos</label>
        <div class="dropzone" id="l-dz">${icon('inbox')}<div>Clique ou arraste vários arquivos aqui</div>
          <div class="hint" style="margin-top:4px">O sistema casa cada arquivo ao cliente pelo <b>CNPJ</b> ou <b>nome</b> no nome do arquivo</div></div>
        <input type="file" id="l-file" hidden multiple />
        <div id="l-chips"></div>
      </div>
      <div id="l-result"></div>`,
    footer: `<button class="btn secondary" data-close>Fechar</button><button class="btn" id="l-enviar" disabled>${icon('inbox')} Importar</button>`,
  });

  const fileInput = m.el.querySelector('#l-file');
  const dz = m.el.querySelector('#l-dz');
  const chips = m.el.querySelector('#l-chips');
  const enviar = m.el.querySelector('#l-enviar');
  let files = [];

  const render = () => {
    chips.innerHTML = files.map((f) => `<div class="file-chip" style="margin-top:6px">${icon('file')}<div><div class="name">${UI.esc(f.name)}</div><div class="size">${UI.fmtSize(f.size)}</div></div></div>`).join('');
    enviar.disabled = files.length === 0;
    enviar.innerHTML = `${icon('inbox')} Importar${files.length ? ` (${files.length})` : ''}`;
  };
  const addFiles = (list) => { files = files.concat([...list]); render(); };
  dz.onclick = () => fileInput.click();
  fileInput.onchange = () => addFiles(fileInput.files);
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('drag'); };
  dz.ondragleave = () => dz.classList.remove('drag');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('drag'); addFiles(e.dataTransfer.files); };

  enviar.onclick = async () => {
    const fd = new FormData();
    files.forEach((f) => fd.append('arquivos', f));
    fd.append('tipo_documento_id', m.el.querySelector('#l-tipo').value);
    fd.append('competencia', m.el.querySelector('#l-comp').value);
    fd.append('vencimento', m.el.querySelector('#l-venc').value);
    enviar.disabled = true; enviar.innerHTML = `${icon('spinner', 'spin')} Importando…`;
    try {
      const res = await API.upload('/documentos/lote', fd);
      onDone();
      m.el.querySelector('#l-result').innerHTML = renderLoteResultado(res, clientes);
      wireAssociacoes(m, clientes, onDone);
      UI.toast(res.nao_casados.length ? 'warning' : 'success', 'Importação concluída', `${res.casados} casado(s), ${res.nao_casados.length} pendente(s).`);
      files = []; chips.innerHTML = ''; fileInput.value = '';
      enviar.innerHTML = `${icon('inbox')} Importar`; enviar.disabled = true;
    } catch (e) {
      UI.toast('error', 'Falha na importação', e.message);
      enviar.disabled = false; enviar.innerHTML = `${icon('inbox')} Importar`;
    }
  };
}

function renderLoteResultado(res, clientes) {
  const casados = res.inseridos.map((i) => `<div class="r-item"><span>${UI.esc(i.arquivo)} → <b>${UI.esc(i.cliente_nome)}</b></span><span class="badge enviado">por ${i.por}</span></div>`).join('');
  const pend = res.nao_casados.map((n, idx) => `
    <div class="r-item" data-orfao="${idx}">
      <span>${UI.esc(n.arquivo)} <span class="muted">(${UI.esc(n.motivo)})</span></span>
      <span style="display:flex;gap:6px">
        <select class="filter sm" data-sel="${idx}"><option value="">Escolher cliente…</option>${clientes.map((c) => `<option value="${c.id}">${UI.esc(c.nome)}</option>`).join('')}</select>
        <button class="btn sm" data-assoc="${idx}">Associar</button>
      </span>
    </div>`).join('');
  window._orfaos = res.nao_casados;
  return `<h3 style="font-size:14px;margin:14px 0 8px">Resultado</h3>
    ${casados}
    ${res.nao_casados.length ? `<div class="alert warn" style="margin:10px 0">${icon('alert')} <div>${res.nao_casados.length} arquivo(s) não reconhecido(s). Associe manualmente abaixo.</div></div>${pend}` : ''}`;
}

function wireAssociacoes(m, clientes, onDone) {
  m.el.querySelectorAll('[data-assoc]').forEach((b) => b.onclick = async () => {
    const idx = b.dataset.assoc;
    const sel = m.el.querySelector(`[data-sel="${idx}"]`);
    if (!sel.value) return UI.toast('warning', 'Escolha um cliente');
    const orfao = window._orfaos[idx];
    b.disabled = true; b.textContent = '…';
    try {
      await API.post('/documentos/associar', { cliente_id: sel.value, caminho: orfao.caminho, nome_arquivo: orfao.arquivo });
      m.el.querySelector(`[data-orfao="${idx}"]`).innerHTML = `<span>${UI.esc(orfao.arquivo)} → associado ✓</span><span class="badge enviado">ok</span>`;
      onDone();
    } catch (e) { UI.toast('error', 'Erro', e.message); b.disabled = false; b.textContent = 'Associar'; }
  });
}

// ================================================================ ENVIO
async function renderEnvio() {
  const alunos = await API.get('/clientes'); // inclui documentos_count
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Envio de Guias</h1><p>Envie guias e boletos por WhatsApp — individual ou em massa por competência</p></div>
      <div class="seg" id="seg">
        <button class="seg-btn active" data-mode="individual">${icon('send')} Individual</button>
        <button class="seg-btn" data-mode="massa">${icon('users')} Em massa</button>
      </div>
    </div>
    <div id="pane-individual"></div>
    <div id="pane-massa" hidden></div>`;

  const MSG_PADRAO = 'Olá {{nome}}, tudo bem?\nSeguem os documentos referentes à competência {{competencia}}:\n\n{{lista}}\n\nOs arquivos estão anexados em PDF. Qualquer dúvida, estamos à disposição.\n\nAtenciosamente,\nEscritório Contábil';
  renderEnvioIndividual(alunos, document.getElementById('pane-individual'), MSG_PADRAO);
  renderEnvioMassa(alunos, document.getElementById('pane-massa'), MSG_PADRAO);

  document.querySelectorAll('#seg .seg-btn').forEach((b) => b.onclick = () => {
    document.querySelectorAll('#seg .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    document.getElementById('pane-individual').hidden = b.dataset.mode !== 'individual';
    document.getElementById('pane-massa').hidden = b.dataset.mode !== 'massa';
  });
}

// ---------- Envio INDIVIDUAL ----------
function renderEnvioIndividual(alunos, root, msgPadrao) {
  root.innerHTML = `
    <div class="send-grid">
      <div class="card card-pad">
        <div class="step">
          <div class="step-label"><span class="num">1</span> Selecionar cliente</div>
          <select class="filter" id="e-cliente" style="width:100%">
            <option value="">Escolha um cliente…</option>
            ${alunos.map((c) => `<option value="${c.id}">${UI.esc(c.nome)} — ${UI.esc(c.telefone)}</option>`).join('')}</select>
          <div id="e-clientecard"></div>
        </div>
        <div class="step">
          <div class="step-label"><span class="num">2</span> Selecionar guia(s)</div>
          <div id="e-docs"><div class="muted" style="font-size:13px">Selecione um cliente para listar as guias.</div></div>
        </div>
        <div class="step">
          <div class="step-label"><span class="num">3</span> Mensagem</div>
          <textarea id="e-msg" rows="6">${msgPadrao}</textarea>
          <div class="mono-count"><span id="e-count">0</span> caracteres · use {{nome}}, {{competencia}} e {{lista}}</div>
        </div>
        ${schedBlock('e')}
        <button class="btn success block" id="e-enviar" disabled>${icon('send')} Enviar via WhatsApp</button>
      </div>
      <div class="wa-preview">
        <div class="wa-head"><div class="av" id="p-av">?</div>
          <div><div class="nm" id="p-nm">Destinatário</div><div class="st" id="p-st">selecione um cliente</div></div></div>
        <div class="wa-body" id="p-body"><div class="wa-empty">A prévia da mensagem aparecerá aqui.</div></div>
      </div>
    </div>`;

  const state = { cliente: null, docs: [], selected: new Set() };
  const $ = (id) => root.querySelector('#' + id);

  const linhaPreview = (d) => {
    const p = [d.tipo_documento || 'Documento'];
    if (d.vencimento) p.push(`vence ${FMT.data(d.vencimento)}`);
    if (typeof d.valor === 'number') p.push(FMT.valor(d.valor));
    return `• ${p.join(' — ')}`;
  };

  const updatePreview = () => {
    const msg = $('e-msg').value;
    $('e-count').textContent = msg.length;
    if (!state.cliente) {
      $('p-av').textContent = '?'; $('p-nm').textContent = 'Destinatário'; $('p-st').textContent = 'selecione um cliente';
      $('p-body').innerHTML = '<div class="wa-empty">A prévia da mensagem aparecerá aqui.</div>';
      return;
    }
    const sel = state.docs.filter((d) => state.selected.has(d.id));
    const lista = sel.map(linhaPreview).join('\n') || '(nenhuma guia selecionada)';
    const comp = FMT.competencia(sel.find((d) => d.competencia)?.competencia);
    const texto = msg.replaceAll('{{nome}}', state.cliente.nome).replaceAll('{{competencia}}', comp === '—' ? 'informada' : comp).replaceAll('{{lista}}', lista);
    const anexos = sel.map((d) => `<div class="wa-attach">${icon('paperclip')}<div class="an">${UI.esc(d.nome_arquivo)}</div></div>`).join('');
    $('p-av').textContent = UI.initials(state.cliente.nome);
    $('p-nm').textContent = state.cliente.nome;
    $('p-st').textContent = state.cliente.telefone;
    $('p-body').innerHTML = `<div class="wa-bubble"><div class="txt">${UI.esc(texto)}</div>${anexos}<div class="wa-time">agora</div></div>`;
  };
  const updateButton = () => { $('e-enviar').disabled = !(state.cliente && state.selected.size); };

  const loadDocs = async () => {
    if (!state.cliente) { $('e-docs').innerHTML = '<div class="muted" style="font-size:13px">Selecione um cliente.</div>'; return; }
    const docs = await API.get(`/documentos?cliente_id=${state.cliente.id}`);
    state.docs = docs; state.selected.clear();
    $('e-docs').innerHTML = docs.length ? `<div class="doc-pick">${docs.map((d) => `
      <label><input type="checkbox" value="${d.id}" />
        <div><div class="dt">${UI.esc(d.nome_arquivo)}</div>
        <div class="dm">${d.tipo_documento || 'Documento'} · ${FMT.competencia(d.competencia)} · ${FMT.valor(d.valor)}</div></div></label>`).join('')}</div>`
      : UI.emptyState('folder', 'Este cliente não possui guias anexadas.');
    $('e-docs').querySelectorAll('input[type=checkbox]').forEach((cb) => cb.onchange = () => {
      const id = Number(cb.value);
      cb.checked ? state.selected.add(id) : state.selected.delete(id);
      updatePreview(); updateButton();
    });
    updatePreview(); updateButton();
  };

  $('e-cliente').onchange = async (e) => {
    state.cliente = alunos.find((c) => c.id == e.target.value) || null;
    $('e-clientecard').innerHTML = state.cliente ? `
      <div class="client-card"><div class="av">${UI.initials(state.cliente.nome)}</div>
        <div><div class="nm">${UI.esc(state.cliente.nome)}</div>
        <div class="meta">${UI.esc(state.cliente.telefone)}</div></div></div>` : '';
    await loadDocs();
  };
  $('e-msg').oninput = updatePreview;
  const sched = wireSched('e', root, $('e-enviar'), `${icon('send')} Enviar via WhatsApp`);

  $('e-enviar').onclick = async () => {
    const btn = $('e-enviar');
    if (sched.agendado() && !sched.valido()) return UI.toast('warning', 'Escolha uma data/hora futura');
    btn.disabled = true; btn.innerHTML = `${icon('spinner', 'spin')} ${sched.agendado() ? 'Agendando…' : 'Enviando…'}`;
    const payload = { cliente_id: state.cliente.id, documento_ids: [...state.selected], mensagem: $('e-msg').value };
    try {
      if (sched.agendado()) {
        await API.post('/agendamentos', { tipo: 'individual', payload, quando: sched.quando() });
        UI.toast('success', 'Envio agendado', `para ${UI.fmtDate(sched.quando())}`);
        root.querySelector('#e-agchk').checked = false; root.querySelector('#e-agdt').style.display = 'none';
      } else {
        const res = await API.post('/enviar', payload);
        if (res.falhas === 0) UI.toast('success', 'Envio concluído', `${res.enviados} guia(s) enviada(s).`);
        else if (res.enviados === 0) UI.toast('error', 'Falha no envio', 'Nenhuma guia foi enviada. Tente novamente.');
        else UI.toast('warning', 'Envio parcial', `${res.enviados} enviada(s), ${res.falhas} falha(s).`);
        await loadDocs();
      }
      refreshWaStatus();
    } catch (e) { UI.toast('error', 'Não foi possível enviar', e.message); }
    btn.innerHTML = `${icon('send')} Enviar via WhatsApp`; updateButton();
  };
  updatePreview();

  // Pré-seleção vinda da ficha do cliente ("Enviar guias")
  if (window._preselectCliente) {
    const sel = $('e-cliente');
    sel.value = window._preselectCliente;
    window._preselectCliente = null;
    if (sel.value) sel.dispatchEvent(new Event('change'));
  }
}

// ---------- Envio EM MASSA ----------
async function renderEnvioMassa(alunos, root, msgPadrao) {
  root.innerHTML = `
    <div class="send-grid">
      <div class="card card-pad">
        <div class="step">
          <div class="step-label"><span class="num">1</span> Competência</div>
          <select class="filter" id="m-comp" style="width:100%"></select>
          <div class="hint" style="margin-top:6px">Envia as guias da competência escolhida para cada cliente.</div>
        </div>
        <div class="step">
          <div class="step-label"><span class="num">2</span> Selecionar clientes</div>
          <div class="search" style="margin-bottom:10px"><input id="m-busca" placeholder="Filtrar clientes por nome…" /></div>
          <div class="mass-selectall">
            <label style="display:flex;gap:8px;align-items:center;cursor:pointer"><input type="checkbox" id="m-all" /> Selecionar todos</label>
            <span class="muted" id="m-count">0 selecionados</span>
          </div>
          <div class="mass-list" id="m-list"></div>
        </div>
        <div class="step">
          <div class="step-label"><span class="num">3</span> Mensagem</div>
          <textarea id="m-msg" rows="6">${msgPadrao}</textarea>
          <div class="mono-count">use {{nome}}, {{competencia}} e {{lista}}</div>
        </div>
        <div class="alert" style="background:var(--success-soft);color:#17824e;margin:4px 0 12px;align-items:flex-start">
          ${icon('clock')}
          <div><b>Ritmo seguro (30 a 60s entre cada envio)</b><br>
          <span style="font-size:12.5px">As mensagens saem <b>uma a uma</b>, com intervalo aleatório, para imitar um envio humano e <b>reduzir o risco de bloqueio</b> do seu WhatsApp. Este ritmo é fixo por segurança.</span></div>
        </div>
        ${schedBlock('m')}
        <button class="btn success block" id="m-enviar" disabled>${icon('send')} Enviar em massa</button>
        <div class="mass-results" id="m-results"></div>
      </div>
      <div class="wa-preview">
        <div class="wa-head"><div class="av">${icon('users')}</div>
          <div><div class="nm">Envio em massa</div><div class="st" id="m-dest">nenhum cliente selecionado</div></div></div>
        <div class="wa-body" id="m-body"><div class="wa-empty">A prévia da mensagem aparecerá aqui.</div></div>
      </div>
    </div>`;

  const $ = (id) => root.querySelector('#' + id);
  const selected = new Set();
  const selDocs = new Map(); // clienteId -> Set(documento_id escolhidos). Ausente = todas (default).
  let filtro = '';
  let docs = [];
  try { docs = await API.get('/documentos'); } catch { docs = []; }

  // competências distintas (desc)
  const comps = [...new Set(docs.map((d) => d.competencia).filter(Boolean))].sort().reverse();
  $('m-comp').innerHTML = `<option value="">Todas as competências</option>` +
    comps.map((c) => `<option value="${c}">${FMT.competencia(c)}</option>`).join('');
  if (comps.length) $('m-comp').value = comps[0];

  const compSel = () => $('m-comp').value;
  const guiasDe = (clienteId) => docs.filter((d) => d.cliente_id === clienteId && (!compSel() || d.competencia === compSel()));
  const visiveis = () => alunos.filter((a) => a.nome.toLowerCase().includes(filtro));

  // Guias efetivamente escolhidas de um cliente (respeita desmarcações; ausente = todas).
  const guiasSelecionadas = (clienteId) => {
    const guias = guiasDe(clienteId);
    const set = selDocs.get(clienteId);
    return set ? guias.filter((g) => set.has(g.id)) : guias;
  };

  const renderList = () => {
    const list = visiveis();
    $('m-list').innerHTML = list.length ? list.map((a) => {
      const guias = guiasDe(a.id);
      const n = guias.length;
      const sem = n === 0;
      if (sem) { selected.delete(a.id); selDocs.delete(a.id); }
      const isSel = selected.has(a.id);
      const set = selDocs.get(a.id);
      const nSel = guias.filter((g) => !set || set.has(g.id)).length;
      const guiasHtml = isSel && n ? `<div class="mass-guias">${guias.map((g) => {
        const on = !set || set.has(g.id);
        return `<label class="mass-guia"><input type="checkbox" data-guia="${a.id}:${g.id}" ${on ? 'checked' : ''}/>
          <span class="mg-tipo">${UI.esc(g.tipo_documento || 'Guia')}${typeof g.valor === 'number' ? ` · ${FMT.valor(g.valor)}` : ''}</span>
          <span class="mg-file">${UI.esc(g.nome_arquivo)}</span></label>`;
      }).join('')}</div>` : '';
      return `<div class="mass-cli ${sem ? 'no-doc' : ''}">
        <label class="mass-cli-head">
          <input type="checkbox" data-cli="${a.id}" ${isSel ? 'checked' : ''} ${sem ? 'disabled' : ''}/>
          <span class="an">${UI.esc(a.nome)}</span>
          <span class="am">${sem ? 'sem guia' : (isSel ? `${nSel} de ${n} guia(s)` : `${n} guia(s)`)}</span>
        </label>${guiasHtml}</div>`;
    }).join('') : '<div class="empty" style="padding:24px">Nenhum cliente encontrado.</div>';

    $('m-list').querySelectorAll('[data-cli]').forEach((cb) => cb.onchange = () => {
      const id = Number(cb.dataset.cli);
      if (cb.checked) { selected.add(id); selDocs.set(id, new Set(guiasDe(id).map((g) => g.id))); }
      else { selected.delete(id); selDocs.delete(id); }
      renderList(); updateUI();
    });
    $('m-list').querySelectorAll('[data-guia]').forEach((cb) => cb.onchange = () => {
      const [cid, gid] = cb.dataset.guia.split(':').map(Number);
      let set = selDocs.get(cid);
      if (!set) { set = new Set(guiasDe(cid).map((g) => g.id)); selDocs.set(cid, set); }
      cb.checked ? set.add(gid) : set.delete(gid);
      renderList(); updateUI();
    });
  };

  const linhaPreview = (d) => {
    const p = [d.tipo_documento || 'Documento'];
    if (d.vencimento) p.push(`vence ${FMT.data(d.vencimento)}`);
    if (typeof d.valor === 'number') p.push(FMT.valor(d.valor));
    return `• ${p.join(' — ')}`;
  };

  const updatePreview = () => {
    const first = alunos.find((a) => selected.has(a.id));
    if (!first) { $('m-body').innerHTML = '<div class="wa-empty">A prévia da mensagem aparecerá aqui.</div>'; $('m-dest').textContent = 'nenhum cliente selecionado'; return; }
    $('m-dest').textContent = `${selected.size} cliente(s) selecionado(s)`;
    const gs = guiasSelecionadas(first.id);
    const lista = gs.map(linhaPreview).join('\n') || '• (nenhuma guia marcada)';
    const comp = FMT.competencia(compSel() || gs.find((d) => d.competencia)?.competencia);
    const texto = $('m-msg').value.replaceAll('{{nome}}', first.nome).replaceAll('{{competencia}}', comp === '—' ? 'informada' : comp).replaceAll('{{lista}}', lista);
    const anexos = gs.map((d) => `<div class="wa-attach">${icon('paperclip')}<div class="an">${UI.esc(d.nome_arquivo)}</div></div>`).join('');
    $('m-body').innerHTML = `<div style="text-align:center;color:#5f7166;font-size:11.5px;margin-bottom:10px">Prévia para <b>${UI.esc(first.nome)}</b></div>
      <div class="wa-bubble"><div class="txt">${UI.esc(texto)}</div>${anexos}<div class="wa-time">agora</div></div>`;
  };

  const updateUI = () => {
    $('m-count').textContent = `${selected.size} selecionados`;
    $('m-enviar').disabled = selected.size === 0;
    const ag = root.querySelector('#m-agchk') && root.querySelector('#m-agchk').checked;
    $('m-enviar').innerHTML = `${icon(ag ? 'clock' : 'send')} ${ag ? 'Agendar em massa' : 'Enviar em massa'}${selected.size ? ` (${selected.size})` : ''}`;
    const vis = visiveis().filter((a) => guiasDe(a.id).length > 0);
    $('m-all').checked = vis.length > 0 && vis.every((a) => selected.has(a.id));
    updatePreview();
  };

  $('m-comp').onchange = () => { selDocs.clear(); renderList(); updateUI(); }; // guias diferem por competência
  $('m-busca').oninput = (e) => { filtro = e.target.value.toLowerCase(); renderList(); updateUI(); };
  $('m-all').onchange = (e) => {
    visiveis().filter((a) => guiasDe(a.id).length > 0).forEach((a) => {
      if (e.target.checked) { selected.add(a.id); selDocs.set(a.id, new Set(guiasDe(a.id).map((g) => g.id))); }
      else { selected.delete(a.id); selDocs.delete(a.id); }
    });
    renderList(); updateUI();
  };
  $('m-msg').oninput = updatePreview;
  const sched = wireSched('m', root, null, null);
  root.querySelector('#m-agchk').addEventListener('change', updateUI);

  $('m-enviar').onclick = async () => {
    const btn = $('m-enviar');
    const selecao = [...selected]
      .map((cid) => ({ cliente_id: cid, documento_ids: guiasSelecionadas(cid).map((g) => g.id) }))
      .filter((s) => s.documento_ids.length);
    if (!selecao.length) return UI.toast('warning', 'Nenhuma guia marcada para envio');
    const payload = { aluno_ids: [...selected], selecao, competencia: compSel(), modo: 'todos', mensagem: $('m-msg').value, ritmo: 'seguro' };
    if (sched.agendado()) {
      if (!sched.valido()) return UI.toast('warning', 'Escolha uma data/hora futura');
      btn.disabled = true; btn.innerHTML = `${icon('spinner', 'spin')} Agendando…`;
      try {
        await API.post('/agendamentos', { tipo: 'massa', payload, quando: sched.quando() });
        UI.toast('success', 'Envio em massa agendado', `${selected.size} cliente(s) · ${UI.fmtDate(sched.quando())}`);
        root.querySelector('#m-agchk').checked = false; root.querySelector('#m-agdt').style.display = 'none'; root.querySelector('#m-agdt').value = '';
      } catch (e) { UI.toast('error', 'Não foi possível agendar', e.message); }
      btn.disabled = false; updateUI(); return;
    }
    btn.disabled = true; btn.innerHTML = `${icon('spinner', 'spin')} Iniciando…`;
    $('m-results').innerHTML = '';
    try {
      const res = await API.post('/enviar-massa', payload);
      if (!res.total) { UI.toast('warning', 'Nenhum cliente para enviar', `${(res.ignorados || []).length} ignorado(s).`); btn.disabled = false; updateUI(); return; }
      UI.toast('info', 'Envio iniciado', `${res.total} cliente(s) na fila, com intervalo entre cada.`);
      acompanharLote(res.lote_id, res.ignorados || []);
    } catch (e) { UI.toast('error', 'Não foi possível enviar', e.message); btn.disabled = false; updateUI(); }
  };

  // Acompanha um lote em segundo plano com barra de progresso.
  function acompanharLote(loteId, ignorados) {
    const render = (l) => {
      const done = l.enviados + l.falhas;
      const pct = l.total ? Math.round(done / l.total * 100) : 100;
      const concl = l.status === 'concluido';
      $('m-results').innerHTML = `
        <div class="lote-prog">
          <div class="lote-head">${concl ? icon('check') : icon('spinner', 'spin')} <b>${concl ? 'Envio concluído' : 'Enviando…'}</b><span class="muted" style="margin-left:auto">${done}/${l.total}</span></div>
          <div class="progbar"><div class="progbar-fill" style="width:${pct}%"></div></div>
          <div class="lote-stats">
            <span class="badge enviado">${l.enviados} enviada(s)</span>
            ${l.falhas ? `<span class="badge falha">${l.falhas} falha(s)</span>` : ''}
            ${l.restantes ? `<span class="badge nao_enviado">${l.restantes} na fila</span>` : ''}
          </div>
          ${!concl ? '<div class="hint" style="margin-top:6px">Pode sair desta tela — o envio continua no servidor, um a um.</div>' : ''}
          ${ignorados.length ? `<div class="hint" style="margin-top:6px">${ignorados.length} ignorado(s): ${ignorados.map((i) => UI.esc(i.aluno_nome)).slice(0, 5).join(', ')}${ignorados.length > 5 ? '…' : ''}</div>` : ''}
        </div>`;
    };
    const tick = async () => {
      try {
        const l = await API.get('/lotes/' + loteId);
        render(l);
        if (l.status === 'concluido') {
          clearInterval(window._lotePoll); window._lotePoll = null;
          UI.toast(l.falhas ? 'warning' : 'success', 'Envio em massa concluído', `${l.enviados} enviada(s)${l.falhas ? `, ${l.falhas} falha(s)` : ''}`);
          $('m-enviar').disabled = false; updateUI();
        }
      } catch { /* ignore */ }
    };
    tick();
    clearInterval(window._lotePoll);
    window._lotePoll = setInterval(tick, 3000);
  }

  renderList(); updateUI();
}

// ================================================================ ENVIO RÁPIDO
const TEMPLATES_RAPIDO = [
  { nome: 'Documento do mês', texto: 'Olá {{nome}}, tudo bem?\nSegue em anexo:\n{{lista}}\n\nQualquer dúvida, estamos à disposição.\nEscritório Contábil' },
  { nome: 'Guia com competência', texto: 'Olá {{nome}}, tudo bem?\nSeguem os documentos referentes à competência {{competencia}}:\n{{lista}}\n\nAtenciosamente,\nEscritório Contábil' },
  { nome: 'Boleto de honorários', texto: 'Olá {{nome}}, tudo bem?\nSegue em anexo o boleto de honorários contábeis. Valor e vencimento estão no documento.\nQualquer dúvida, estamos à disposição!' },
  { nome: 'Lembrete de vencimento', texto: 'Olá {{nome}}! Passando para lembrar do vencimento próximo do documento em anexo. Se já efetuou o pagamento, pode desconsiderar.\nAbraço, Escritório Contábil' },
  { nome: 'Mensagem em branco', texto: '' },
];

async function renderEnvioRapido() {
  const clientes = await API.get('/clientes');
  view.innerHTML = `
    <div class="page-head"><div><h1>Envio Rápido</h1><p>Cliente, documento e mensagem numa tela só — sem passar por várias abas</p></div></div>
    <div class="send-grid">
      <div class="card card-pad">
        <div class="step">
          <div class="step-label"><span class="num">1</span> Cliente</div>
          <select class="filter" id="r-cli" style="width:100%">
            <option value="">Selecione um cliente…</option>
            <option value="__novo__">➕ Cadastrar novo cliente</option>
            ${clientes.map((c) => `<option value="${c.id}">${UI.esc(c.nome)} — ${UI.esc(c.telefone)}</option>`).join('')}
          </select>
          <div id="r-novo" hidden style="margin-top:12px">
            <div class="form-row">
              <div class="field" style="margin:0"><label>Nome / Razão Social</label><input id="r-nome" placeholder="Ex: Comércio Silva Ltda" /></div>
              <div class="field" style="margin:0"><label>WhatsApp</label><input id="r-tel" placeholder="(11) 99999-9999" inputmode="numeric" /></div>
            </div>
          </div>
        </div>
        <div class="step">
          <div class="step-label"><span class="num">2</span> Documento(s) <span class="opt" style="font-weight:400;color:var(--text-2)">(opcional)</span></div>
          <div class="dropzone" id="r-dz">${icon('upload')}<div>Clique ou arraste arquivos aqui</div>
            <div class="hint" style="margin-top:4px">Uma ou mais guias/boletos · ou deixe vazio para enviar só a mensagem</div></div>
          <input type="file" id="r-file" hidden multiple />
          <div id="r-chips"></div>
          <div class="field" style="margin:12px 0 0"><label>Competência <span class="opt">(opcional — usada na mensagem)</span></label>
            <input type="month" id="r-comp" /></div>
        </div>
        <div class="step">
          <div class="step-label"><span class="num">3</span> Mensagem</div>
          <select class="filter" id="r-tpl" style="width:100%;margin-bottom:8px">
            ${TEMPLATES_RAPIDO.map((t, i) => `<option value="${i}">${UI.esc(t.nome)}</option>`).join('')}
          </select>
          <textarea id="r-msg" rows="6">${TEMPLATES_RAPIDO[0].texto}</textarea>
          <div class="mono-count">use {{nome}}, {{competencia}} e {{lista}}</div>
        </div>
        ${schedBlock('r')}
        <button class="btn success block" id="r-enviar" disabled>${icon('send')} Enviar via WhatsApp</button>
      </div>
      <div class="wa-preview">
        <div class="wa-head"><div class="av" id="r-av">?</div>
          <div><div class="nm" id="r-nm">Destinatário</div><div class="st" id="r-st">selecione um cliente</div></div></div>
        <div class="wa-body" id="r-body"><div class="wa-empty">A prévia da mensagem aparecerá aqui.</div></div>
      </div>
    </div>`;

  const $ = (id) => document.getElementById(id);
  let files = [];

  const clienteAtual = () => {
    const v = $('r-cli').value;
    if (v === '__novo__') return { novo: true, nome: $('r-nome').value.trim(), telefone: $('r-tel').value.trim() };
    const c = clientes.find((x) => x.id == v);
    return c ? { ...c, novo: false } : null;
  };

  const podeEnviar = () => {
    const c = clienteAtual();
    if (!c) return false;
    if (c.novo && (!c.nome || !c.telefone)) return false;
    return files.length > 0 || $('r-msg').value.trim().length > 0;
  };

  const renderChips = () => {
    $('r-chips').innerHTML = files.map((f, i) => `<div class="file-chip" style="margin-top:6px">${icon('file')}<div><div class="name">${UI.esc(f.name)}</div><div class="size">${UI.fmtSize(f.size)}</div></div><button class="icon-btn" data-rm="${i}">${icon('x')}</button></div>`).join('');
    $('r-chips').querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { files.splice(Number(b.dataset.rm), 1); renderChips(); update(); });
  };

  const update = () => {
    $('r-enviar').disabled = !podeEnviar();
    const c = clienteAtual();
    if (!c || (c.novo && !c.nome)) {
      $('r-av').textContent = '?'; $('r-nm').textContent = 'Destinatário'; $('r-st').textContent = 'selecione um cliente';
      $('r-body').innerHTML = '<div class="wa-empty">A prévia da mensagem aparecerá aqui.</div>';
      return;
    }
    const comp = FMT.competencia($('r-comp').value);
    const lista = files.map((f) => `• ${f.name}`).join('\n') || '(documento)';
    const texto = $('r-msg').value
      .replaceAll('{{nome}}', c.nome).replaceAll('{{competencia}}', comp === '—' ? 'informada' : comp).replaceAll('{{lista}}', lista);
    const anexos = files.map((f) => `<div class="wa-attach">${icon('paperclip')}<div class="an">${UI.esc(f.name)}</div></div>`).join('');
    $('r-av').textContent = UI.initials(c.nome);
    $('r-nm').textContent = c.nome; $('r-st').textContent = c.telefone || '—';
    $('r-body').innerHTML = texto.trim() || anexos
      ? `<div class="wa-bubble"><div class="txt">${UI.esc(texto)}</div>${anexos}<div class="wa-time">agora</div></div>`
      : '<div class="wa-empty">Escreva uma mensagem ou anexe um documento.</div>';
  };

  $('r-cli').onchange = () => { $('r-novo').hidden = $('r-cli').value !== '__novo__'; update(); };
  $('r-nome').oninput = update; $('r-comp').onchange = update; $('r-msg').oninput = update;
  UI.bindMask($('r-tel'), UI.maskPhone); $('r-tel').addEventListener('input', update);
  $('r-tpl').onchange = () => { $('r-msg').value = TEMPLATES_RAPIDO[Number($('r-tpl').value)].texto; update(); };
  const sched = wireSched('r', document, $('r-enviar'), `${icon('send')} Enviar via WhatsApp`);

  const dz = $('r-dz'), fileInput = $('r-file');
  const addFiles = (list) => { files = files.concat([...list]); renderChips(); update(); };
  dz.onclick = () => fileInput.click();
  fileInput.onchange = () => addFiles(fileInput.files);
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('drag'); };
  dz.ondragleave = () => dz.classList.remove('drag');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('drag'); addFiles(e.dataTransfer.files); };

  $('r-enviar').onclick = async () => {
    const btn = $('r-enviar');
    if (sched.agendado() && !sched.valido()) return UI.toast('warning', 'Escolha uma data/hora futura');
    btn.disabled = true; btn.innerHTML = `${icon('spinner', 'spin')} ${sched.agendado() ? 'Agendando…' : 'Enviando…'}`;
    try {
      let c = clienteAtual();
      // 1) cria o cliente se for novo
      if (c.novo) {
        const novo = await API.post('/clientes', { nome: c.nome, telefone: c.telefone });
        c = { ...novo, novo: false };
      }
      // 2) sobe os documentos (agora, mesmo que o envio seja agendado)
      const comp = $('r-comp').value;
      const ids = [];
      for (const f of files) {
        const fd = new FormData();
        fd.append('arquivo', f); fd.append('cliente_id', c.id);
        if (comp) fd.append('competencia', comp);
        const doc = await API.upload('/documentos', fd);
        ids.push(doc.id);
      }
      // 3) envia agora OU agenda
      const payload = { cliente_id: c.id, documento_ids: ids, mensagem: $('r-msg').value };
      if (sched.agendado()) {
        await API.post('/agendamentos', { tipo: 'individual', payload, quando: sched.quando() });
        UI.toast('success', 'Envio agendado', `para ${UI.fmtDate(sched.quando())}`);
      } else {
        const res = await API.post('/enviar', payload);
        if (res.falhas === 0) UI.toast('success', 'Enviado!', `${res.enviados} envio(s) para ${c.nome}.`);
        else UI.toast('error', 'Falha no envio', 'Verifique a conexão do WhatsApp e tente novamente.');
      }
      // limpa para o próximo envio
      files = []; renderChips();
      $('r-cli').innerHTML = `<option value="">Selecione um cliente…</option><option value="__novo__">➕ Cadastrar novo cliente</option>` +
        (await API.get('/clientes')).map((x) => `<option value="${x.id}">${UI.esc(x.nome)} — ${UI.esc(x.telefone)}</option>`).join('');
      $('r-novo').hidden = true;
      $('r-agchk').checked = false; $('r-agdt').style.display = 'none'; $('r-agdt').value = '';
      refreshWaStatus();
    } catch (e) { UI.toast('error', 'Não foi possível enviar', e.message); }
    btn.innerHTML = `${icon('send')} Enviar via WhatsApp`; update();
  };

  update();
}

// ================================================================ AGENDAMENTOS
async function renderAgendamentos() {
  view.innerHTML = `
    <div class="page-head"><div><h1>Agendamentos</h1><p>Envios programados para uma data/hora futura</p></div>
      <button class="btn" onclick="navigate('envio')">${icon('send')} Novo envio</button></div>
    <div id="tabela"></div>`;

  const load = async () => {
    const list = await API.get('/agendamentos');
    const stBadge = { pendente: 'aberta', processando: 'pendente', enviado: 'enviado', falha: 'falha', cancelado: 'nao_enviado' };
    const stLabel = { pendente: 'Agendado', processando: 'Enviando…', enviado: 'Enviado', falha: 'Falha', cancelado: 'Cancelado' };
    document.getElementById('tabela').innerHTML = list.length ? `
      <div class="table-wrap"><table><thead><tr>
        <th>Quando</th><th>Tipo</th><th>Destino</th><th>Status</th><th>Resultado</th><th></th>
      </tr></thead><tbody>${list.map((a) => {
        let resultado = '—';
        if (a.resumo) resultado = a.resumo.erro ? UI.esc(a.resumo.erro) : `${a.resumo.enviados} enviada(s)${a.resumo.falhas ? `, ${a.resumo.falhas} falha(s)` : ''}`;
        return `<tr>
          <td class="mono">${UI.fmtDate(a.quando)}</td>
          <td>${a.tipo === 'massa' ? 'Em massa' : 'Individual'}</td>
          <td>${UI.esc(a.destino)}</td>
          <td><span class="badge ${stBadge[a.status] || 'nao_enviado'}">${stLabel[a.status] || a.status}</span></td>
          <td class="muted" style="font-size:12.5px">${resultado}</td>
          <td class="actions">${a.status === 'pendente' ? `<button class="icon-btn danger" data-cancel="${a.id}" title="Cancelar">${icon('trash')}</button>` : ''}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`
      : UI.emptyState('calendar', 'Nenhum envio agendado. Marque "Agendar para depois" na tela de envio.');

    document.querySelectorAll('[data-cancel]').forEach((b) => b.onclick = async () => {
      const ok = await UI.confirm({ title: 'Cancelar agendamento', message: 'Cancelar este envio agendado?', confirmLabel: 'Cancelar envio' });
      if (!ok) return;
      try { await API.del(`/agendamentos/${b.dataset.cancel}`); UI.toast('success', 'Agendamento cancelado'); load(); }
      catch (e) { UI.toast('error', 'Erro', e.message); }
    });
  };
  await load();
  clearInterval(window._agPoll);
  window._agPoll = setInterval(() => { if (location.hash.includes('agendamentos')) load(); }, 20000);
}

// ================================================================ CONEXÃO WHATSAPP
async function renderWhatsapp() {
  view.innerHTML = `
    <div class="page-head"><div><h1>Conexão WhatsApp</h1><p>Conecte o WhatsApp do seu escritório para enviar as guias</p></div></div>
    <div id="wa-pane"><div class="empty">Carregando…</div></div>`;
  const pane = document.getElementById('wa-pane');

  const renderConectado = (s) => {
    pane.innerHTML = `
      <div class="card card-pad" style="max-width:540px">
        <div style="display:flex;align-items:center;gap:14px">
          <div class="kpi-ico green" style="width:52px;height:52px">${icon('whatsapp')}</div>
          <div><h3 style="font-size:17px">WhatsApp conectado</h3>
            <div class="muted" style="font-size:13px">${UI.esc(s.detalhe || '')}</div></div>
        </div>
        <div class="alert warn" style="margin-top:16px">${icon('alert')}<div>Ao desconectar, será preciso ler o QR Code de novo para voltar a enviar.</div></div>
        <button class="btn danger" id="wa-off" style="margin-top:16px">${icon('power')} Desconectar WhatsApp</button>
      </div>`;
    document.getElementById('wa-off').onclick = async () => {
      const ok = await UI.confirm({ title: 'Desconectar WhatsApp', message: 'Você precisará reconectar (novo QR) para enviar guias. Continuar?', confirmLabel: 'Desconectar' });
      if (!ok) return;
      try { await API.post('/whatsapp/desconectar'); UI.toast('success', 'WhatsApp desconectado'); refreshWaStatus(); renderWhatsapp(); }
      catch (e) { UI.toast('error', 'Erro', e.message); }
    };
  };

  const renderConectar = () => {
    pane.innerHTML = `
      <div class="card card-pad" style="max-width:540px;text-align:center">
        <div class="kpi-ico" style="width:52px;height:52px;margin:0 auto 10px;background:var(--warning-soft);color:var(--warning)">${icon('whatsapp')}</div>
        <h3 style="font-size:17px">Nenhum WhatsApp conectado</h3>
        <p class="muted" style="font-size:13.5px;margin:6px 0 16px">Conecte o número do seu escritório para enviar as guias por aqui.</p>
        <button class="btn success" id="wa-start">${icon('link')} Conectar meu WhatsApp</button>
      </div>`;
    document.getElementById('wa-start').onclick = iniciarQR;
  };

  const iniciarQR = () => {
    pane.innerHTML = `
      <div class="card card-pad" style="max-width:540px;text-align:center">
        <h3 style="font-size:16px">Leia o QR Code</h3>
        <ol class="steps" style="max-width:340px;margin:10px auto;text-align:left;font-size:13px;color:var(--text-2)">
          <li>Abra o <b>WhatsApp</b> no celular</li>
          <li>Toque em <b>⋮ → Dispositivos conectados</b></li>
          <li>Toque em <b>Conectar um dispositivo</b> e aponte para o código</li>
        </ol>
        <div id="wa-qr" class="qr-loading">${icon('spinner', 'spin')} Gerando QR…</div>
        <div class="hint">O código atualiza sozinho. Assim que conectar, esta tela avança.</div>
      </div>`;
    const tick = async () => {
      try {
        const r = await API.get('/whatsapp/qr');
        if (r.conectado) { clearInterval(window._waPoll); window._waPoll = null; UI.toast('success', 'WhatsApp conectado!'); refreshWaStatus(); renderWhatsapp(); return; }
        if (r.base64) document.getElementById('wa-qr').innerHTML = `<img src="${r.base64}" alt="QR Code" style="width:250px;height:250px;image-rendering:pixelated" />`;
      } catch (e) { const el = document.getElementById('wa-qr'); if (el) el.innerHTML = `<div class="muted">${UI.esc(e.message)}</div>`; }
    };
    tick();
    window._waPoll = setInterval(tick, 6000);
  };

  try {
    const s = await API.get('/whatsapp/status');
    if (s.provider === 'mock') { pane.innerHTML = UI.emptyState('whatsapp', 'Modo simulação — Evolution API não configurada no servidor.'); return; }
    if (s.conectado) renderConectado(s); else renderConectar();
  } catch (e) { pane.innerHTML = UI.emptyState('alert', e.message); }
}

// ================================================================ ADMIN (contas)
async function renderAdmin() {
  if (!window._me || window._me.role !== 'admin') { view.innerHTML = UI.emptyState('shield', 'Acesso restrito ao administrador.'); return; }
  view.innerHTML = `
    <div class="page-head"><div><h1>Contas</h1><p>Gerencie quem acessa o sistema · cada conta vê apenas os próprios dados</p></div>
      <button class="btn" id="novo">${icon('plus')} Nova conta</button></div>
    <div id="tabela"></div>`;

  const load = async () => {
    const list = await API.get('/admin/users');
    document.getElementById('tabela').innerHTML = `<div class="table-wrap"><table><thead><tr>
      <th>Nome</th><th>E-mail (login)</th><th>Papel</th><th>Status</th><th>Criada em</th><th></th>
    </tr></thead><tbody>${list.map((u) => `
      <tr>
        <td><b>${UI.esc(u.nome)}</b></td>
        <td class="mono muted">${UI.esc(u.email)}</td>
        <td>${u.role === 'admin' ? '<span class="badge" style="background:var(--primary-soft);color:var(--primary)">Admin</span>' : '<span class="badge nao_enviado">Usuário</span>'}</td>
        <td>${u.ativo ? UI.badge('paga').replace('Paga', 'Ativa') : UI.badge('falha').replace('Falha', 'Inativa')}</td>
        <td class="muted">${UI.fmtDate(u.criado_em)}</td>
        <td class="actions">
          <button class="icon-btn" data-edit="${u.id}" title="Editar / trocar senha">${icon('edit')}</button>
          <button class="icon-btn" data-toggle="${u.id}" title="${u.ativo ? 'Desativar' : 'Ativar'}">${icon(u.ativo ? 'x' : 'check')}</button>
          ${u.id === window._me.id ? '' : `<button class="icon-btn danger" data-del="${u.id}" title="Excluir">${icon('trash')}</button>`}
        </td>
      </tr>`).join('')}</tbody></table></div>`;

    document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => formUser(list.find((u) => u.id == b.dataset.edit), load));
    document.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = async () => {
      const u = list.find((x) => x.id == b.dataset.toggle);
      try { await API.put(`/admin/users/${u.id}`, { ativo: !u.ativo }); UI.toast('success', u.ativo ? 'Conta desativada' : 'Conta ativada'); load(); }
      catch (e) { UI.toast('error', 'Erro', e.message); }
    });
    document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      const u = list.find((x) => x.id == b.dataset.del);
      const ok = await UI.confirm({ title: 'Excluir conta', message: `Excluir a conta de "${u.nome}"? Ela perde o acesso ao sistema.` });
      if (!ok) return;
      try { await API.del(`/admin/users/${u.id}`); UI.toast('success', 'Conta excluída'); load(); }
      catch (e) { UI.toast('error', 'Erro', e.message); }
    });
  };

  document.getElementById('novo').onclick = () => formUser(null, load);
  await load();
}

function formUser(user, onDone) {
  const editando = !!user;
  const m = UI.modal({
    title: editando ? 'Editar conta' : 'Nova conta',
    body: `
      <div class="field"><label>Nome do escritório / usuário</label>
        <input id="u-nome" value="${editando ? UI.esc(user.nome) : ''}" placeholder="Ex: Contabilidade Silva" /></div>
      <div class="field"><label>E-mail (login)</label>
        <input id="u-email" type="email" value="${editando ? UI.esc(user.email) : ''}" ${editando ? 'disabled' : ''} placeholder="conta@escritorio.com" /></div>
      <div class="field"><label>Senha ${editando ? '<span class="opt">(em branco = manter atual)</span>' : ''}</label>
        <input id="u-senha" type="text" placeholder="mínimo 6 caracteres" />
        <div class="hint">A senha fica visível para você poder repassar ao usuário.</div></div>
      <div class="field"><label>Papel</label>
        <select id="u-role">
          <option value="user" ${editando && user.role === 'user' ? 'selected' : ''}>Usuário (usa o sistema)</option>
          <option value="admin" ${editando && user.role === 'admin' ? 'selected' : ''}>Administrador (gerencia contas)</option>
        </select></div>`,
    footer: `<button class="btn secondary" data-close>Cancelar</button><button class="btn" id="salvar">${icon('check')} Salvar</button>`,
  });
  m.el.querySelector('#salvar').onclick = async () => {
    const payload = { nome: m.el.querySelector('#u-nome').value, role: m.el.querySelector('#u-role').value };
    const senha = m.el.querySelector('#u-senha').value;
    if (senha) payload.senha = senha;
    try {
      if (editando) {
        await API.put(`/admin/users/${user.id}`, payload);
      } else {
        if (!senha) return UI.toast('warning', 'Defina uma senha para a nova conta');
        payload.email = m.el.querySelector('#u-email').value;
        await API.post('/admin/users', payload);
      }
      m.close(); UI.toast('success', editando ? 'Conta atualizada' : 'Conta criada'); onDone();
    } catch (e) { UI.toast('error', 'Não foi possível salvar', e.message); }
  };
}

// ================================================================ BOOT
async function boot() {
  paintIcons();
  let me;
  try { me = (await API.get('/auth/me')).user; }
  catch { location.href = '/login.html'; return; }
  window._me = me;

  document.getElementById('userNome').textContent = me.nome;
  document.getElementById('userRole').textContent = me.role === 'admin' ? 'Administrador' : 'Usuário';
  document.getElementById('userAv').textContent = UI.initials(me.nome);
  if (me.role === 'admin') document.getElementById('nav-admin').hidden = false;
  document.getElementById('logout').onclick = async () => {
    try { await API.post('/auth/logout'); } catch { /* ignore */ }
    location.href = '/login.html';
  };

  document.querySelectorAll('.nav-item').forEach((n) => n.addEventListener('click', () => navigate(n.dataset.route)));
  window.addEventListener('hashchange', router);
  router();
  refreshWaStatus();
  setInterval(refreshWaStatus, 30000);
}
boot();
