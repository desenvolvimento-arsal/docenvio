// Serviço de WhatsApp POR INSTÂNCIA (multi-conta): cada conta tem sua própria
// instância na Evolution API (mesmo servidor + mesma apikey global, instância própria).
//
//  - 'evolution' : integra com a Evolution API (real). Ativo se EVOLUTION_API_URL + EVOLUTION_API_KEY.
//  - 'mock'      : fallback local (simula latência e sucesso/falha) quando a Evolution não está configurada.
//
// Docs Evolution API:
//   POST   /instance/create
//   GET    /instance/connect/{instance}          (QR)
//   GET    /instance/connectionState/{instance}
//   DELETE /instance/logout/{instance}
//   POST   /message/sendText/{instance}
//   POST   /message/sendMedia/{instance}
import { readFile } from 'node:fs/promises';
import { phoneForWaMe } from './validators.js';

const {
  EVOLUTION_API_URL,
  EVOLUTION_API_KEY,
  MOCK_FORCE, // 'success' | 'fail' — força o resultado no modo mock (útil p/ testes)
} = process.env;

export const PROVIDER = EVOLUTION_API_URL && EVOLUTION_API_KEY ? 'evolution' : 'mock';

// ------------------------------------------------------------------ util
export function buildWaLink(telefoneE164, texto) {
  return `https://wa.me/${phoneForWaMe(telefoneE164)}?text=${encodeURIComponent(texto)}`;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ mock provider
const MOCK_SUCCESS_RATE = 0.85;
const MOTIVOS_FALHA = [
  'Número não registrado no WhatsApp', 'Tempo de conexão esgotado (timeout)',
  'Mídia rejeitada pelo provedor', 'Sessão do WhatsApp expirada',
];
function fakeMessageId() {
  const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `wamid.MOCK-${hex()}${hex()}-${hex()}${hex()}`;
}
async function enviarMock() {
  await sleep(300 + Math.random() * 1200);
  const sucesso = MOCK_FORCE === 'success' ? true : MOCK_FORCE === 'fail' ? false : Math.random() < MOCK_SUCCESS_RATE;
  return sucesso
    ? { status: 'enviado', providerMessageId: fakeMessageId() }
    : { status: 'falha', erro: MOTIVOS_FALHA[Math.floor(Math.random() * MOTIVOS_FALHA.length)] };
}

// -------------------------------------------------------- evolution provider
const evoUrl = (path) => `${EVOLUTION_API_URL.replace(/\/$/, '')}${path}`;
const evoHeaders = (extra = {}) => ({ apikey: EVOLUTION_API_KEY, 'Content-Type': 'application/json', ...extra });

// fetch com timeout (evita travar se a Evolution não responder).
async function evoFetch(url, opts = {}, ms = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Evolution não respondeu (timeout).');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/** Estado da conexão da instância: 'open' | 'connecting' | 'close' | 'inexistente'. */
export async function evolutionState(instance) {
  const res = await evoFetch(evoUrl(`/instance/connectionState/${instance}`), { headers: evoHeaders() });
  if (res.status === 404) return 'inexistente';
  if (!res.ok) throw new Error(`Evolution respondeu ${res.status}`);
  const data = await res.json().catch(() => ({}));
  return data?.instance?.state ?? 'unknown';
}

/** Cria a instância se ainda não existir (ignora "já existe"). */
export async function evolutionCreateInstance(instance) {
  const res = await evoFetch(evoUrl('/instance/create'), {
    method: 'POST',
    headers: evoHeaders(),
    body: JSON.stringify({ instanceName: instance, integration: 'WHATSAPP-BAILEYS', qrcode: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { base64: data?.qrcode?.base64 || null, code: data?.qrcode?.code || null };
  // 403/409 => já existe; qualquer outro erro é propagado
  if (res.status === 403 || res.status === 409) return null;
  throw new Error(data?.message || data?.response?.message || `HTTP ${res.status}`);
}

/** Garante a instância e retorna o QR Code (base64) para conectar. */
export async function evolutionConnect(instance) {
  const estado = await evolutionState(instance);
  if (estado === 'inexistente') {
    const criado = await evolutionCreateInstance(instance);
    if (criado?.base64) return criado; // create já devolve QR
  }
  const res = await evoFetch(evoUrl(`/instance/connect/${instance}`), { headers: evoHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return { base64: data?.base64 || null, code: data?.code || null, pairingCode: data?.pairingCode || null };
}

/** Desconecta o WhatsApp da instância (logout). */
export async function evolutionLogout(instance) {
  const res = await evoFetch(evoUrl(`/instance/logout/${instance}`), { method: 'DELETE', headers: evoHeaders() });
  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.message || `HTTP ${res.status}`);
  }
  return true;
}

// Delay (ms) que a Evolution mostra "digitando" antes de enviar — deixa o envio mais humano.
const TYPING_DELAY_MS = 1200;

async function evolutionSendText(instance, number, text) {
  const res = await evoFetch(evoUrl(`/message/sendText/${instance}`), {
    method: 'POST', headers: evoHeaders(), body: JSON.stringify({ number, text, delay: TYPING_DELAY_MS }),
  }, 30000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  return data;
}

async function evolutionSendMedia(instance, number, { caminho, nome_arquivo, mime_type }, caption) {
  const buffer = await readFile(caminho);
  const res = await evoFetch(evoUrl(`/message/sendMedia/${instance}`), {
    method: 'POST', headers: evoHeaders(),
    body: JSON.stringify({
      number, mediatype: mediatypeFor(mime_type), mimetype: mime_type || 'application/octet-stream',
      media: buffer.toString('base64'), fileName: nome_arquivo, caption, delay: TYPING_DELAY_MS,
    }),
  }, 45000);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  return data;
}

function mediatypeFor(mime = '') {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}
const providerMessageId = (data) => data?.key?.id || data?.message?.key?.id || null;

// ------------------------------------------------------------------ fachada
/**
 * Envia mensagem (e opcionalmente um documento) pela instância informada.
 * @param {{instance:string, telefone:string, texto:string, documento?:object}} params
 */
export async function enviarWhatsApp({ instance, telefone, texto, documento }) {
  const waLink = buildWaLink(telefone, texto);
  const numero = phoneForWaMe(telefone);
  if (PROVIDER === 'mock') return { ...(await enviarMock()), provider: 'mock', waLink };
  try {
    const data = documento
      ? await evolutionSendMedia(instance, numero, documento, texto)
      : await evolutionSendText(instance, numero, texto);
    return { status: 'enviado', provider: 'evolution', providerMessageId: providerMessageId(data), waLink };
  } catch (err) {
    return { status: 'falha', provider: 'evolution', erro: err.message, waLink };
  }
}

/** Status da conexão da instância do usuário, para a interface. */
export async function whatsappStatus(instance) {
  if (PROVIDER === 'mock') {
    return { provider: 'mock', conectado: true, estado: 'mock', instancia: instance, detalhe: 'Modo simulação (Evolution não configurada).' };
  }
  try {
    const estado = await evolutionState(instance);
    const mapa = {
      open: 'WhatsApp conectado.', connecting: 'Aguardando leitura do QR Code…',
      close: 'WhatsApp desconectado.', inexistente: 'Nenhum WhatsApp conectado ainda.',
    };
    return { provider: 'evolution', conectado: estado === 'open', estado, instancia: instance, detalhe: mapa[estado] || `Estado: ${estado}.` };
  } catch (err) {
    return { provider: 'evolution', conectado: false, estado: 'erro', instancia: instance, detalhe: err.message };
  }
}
