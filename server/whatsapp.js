// Serviço de envio por WhatsApp com dois provedores:
//  - 'evolution' : integra com a Evolution API (real), configurado por variáveis de ambiente.
//  - 'mock'      : fallback local (simula latência e sucesso/falha) quando não há instância configurada.
//
// A seleção é automática: se EVOLUTION_API_URL + EVOLUTION_API_KEY + EVOLUTION_INSTANCE
// estiverem definidos, usa a Evolution API; caso contrário, cai no mock.
//
// Docs Evolution API:
//   POST /message/sendText/{instance}
//   POST /message/sendMedia/{instance}
//   GET  /instance/connectionState/{instance}
import { readFile } from 'node:fs/promises';
import { phoneForWaMe } from './validators.js';

const {
  EVOLUTION_API_URL,
  EVOLUTION_API_KEY,
  EVOLUTION_INSTANCE,
  MOCK_FORCE, // 'success' | 'fail' — força o resultado no modo mock (útil p/ testes)
} = process.env;

export const PROVIDER =
  EVOLUTION_API_URL && EVOLUTION_API_KEY && EVOLUTION_INSTANCE ? 'evolution' : 'mock';

// ------------------------------------------------------------------ util

/** Gera o link wa.me (fallback para envio manual pelo operador). */
export function buildWaLink(telefoneE164, texto) {
  return `https://wa.me/${phoneForWaMe(telefoneE164)}?text=${encodeURIComponent(texto)}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ------------------------------------------------------------ mock provider

const MOCK_SUCCESS_RATE = 0.85;
const MOTIVOS_FALHA = [
  'Número não registrado no WhatsApp',
  'Tempo de conexão esgotado (timeout)',
  'Mídia rejeitada pelo provedor',
  'Sessão do WhatsApp expirada',
];

function fakeMessageId() {
  const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `wamid.MOCK-${hex()}${hex()}-${hex()}${hex()}`;
}

async function enviarMock({ texto }) {
  await sleep(300 + Math.random() * 1200); // 0.3s – 1.5s
  const forced = MOCK_FORCE;
  const sucesso =
    forced === 'success' ? true : forced === 'fail' ? false : Math.random() < MOCK_SUCCESS_RATE;
  if (sucesso) return { status: 'enviado', providerMessageId: fakeMessageId() };
  return { status: 'falha', erro: MOTIVOS_FALHA[Math.floor(Math.random() * MOTIVOS_FALHA.length)] };
}

// -------------------------------------------------------- evolution provider

function evoUrl(path) {
  return `${EVOLUTION_API_URL.replace(/\/$/, '')}${path}`;
}

function evoHeaders(extra = {}) {
  return { apikey: EVOLUTION_API_KEY, 'Content-Type': 'application/json', ...extra };
}

/** Consulta o estado da conexão da instância na Evolution API. */
export async function evolutionState() {
  const res = await fetch(evoUrl(`/instance/connectionState/${EVOLUTION_INSTANCE}`), {
    headers: evoHeaders(),
  });
  if (!res.ok) throw new Error(`Evolution respondeu ${res.status}`);
  const data = await res.json();
  return data?.instance?.state ?? 'unknown'; // open | connecting | close
}

/** Obtém o QR Code (base64) para conectar a instância ao WhatsApp. */
export async function evolutionConnect() {
  const res = await fetch(evoUrl(`/instance/connect/${EVOLUTION_INSTANCE}`), { headers: evoHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return { base64: data?.base64 || null, code: data?.code || null, pairingCode: data?.pairingCode || null };
}

async function evolutionSendText(number, text) {
  const res = await fetch(evoUrl(`/message/sendText/${EVOLUTION_INSTANCE}`), {
    method: 'POST',
    headers: evoHeaders(),
    body: JSON.stringify({ number, text }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  return data;
}

async function evolutionSendMedia(number, { caminho, nome_arquivo, mime_type }, caption) {
  const buffer = await readFile(caminho);
  const res = await fetch(evoUrl(`/message/sendMedia/${EVOLUTION_INSTANCE}`), {
    method: 'POST',
    headers: evoHeaders(),
    body: JSON.stringify({
      number,
      mediatype: mediatypeFor(mime_type),
      mimetype: mime_type || 'application/octet-stream',
      media: buffer.toString('base64'),
      fileName: nome_arquivo,
      caption,
    }),
  });
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

function providerMessageId(data) {
  return data?.key?.id || data?.message?.key?.id || null;
}

// ------------------------------------------------------------------ fachada

/**
 * Envia uma mensagem (e opcionalmente um documento) por WhatsApp.
 * @param {{telefone:string, texto:string, documento?:{caminho:string,nome_arquivo:string,mime_type:string}}} params
 * @returns {Promise<{status:'enviado'|'falha', provider:string, providerMessageId?:string, erro?:string, waLink:string}>}
 */
export async function enviarWhatsApp({ telefone, texto, documento }) {
  const waLink = buildWaLink(telefone, texto);
  const numero = phoneForWaMe(telefone); // só dígitos, ex: 5511999998888

  if (PROVIDER === 'mock') {
    const r = await enviarMock({ texto });
    return { ...r, provider: 'mock', waLink };
  }

  try {
    let data;
    if (documento) {
      data = await evolutionSendMedia(numero, documento, texto);
    } else {
      data = await evolutionSendText(numero, texto);
    }
    return { status: 'enviado', provider: 'evolution', providerMessageId: providerMessageId(data), waLink };
  } catch (err) {
    return { status: 'falha', provider: 'evolution', erro: err.message, waLink };
  }
}

/** Status do provedor de WhatsApp para exibição na interface. */
export async function whatsappStatus() {
  if (PROVIDER === 'mock') {
    return { provider: 'mock', conectado: true, estado: 'mock', detalhe: 'Modo simulação (sem instância Evolution configurada).' };
  }
  try {
    const estado = await evolutionState();
    return {
      provider: 'evolution',
      conectado: estado === 'open',
      estado,
      instancia: EVOLUTION_INSTANCE,
      detalhe: estado === 'open' ? 'Instância conectada.' : `Instância ${estado}.`,
    };
  } catch (err) {
    return { provider: 'evolution', conectado: false, estado: 'erro', instancia: EVOLUTION_INSTANCE, detalhe: err.message };
  }
}
