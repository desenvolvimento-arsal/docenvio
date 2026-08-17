// Persistência com dois backends, mesma API síncrona:
//  - PostgreSQL (produção): se DATABASE_URL estiver definido. Guarda TODO o estado como
//    um documento JSONB (tabela app_state, 1 linha). Cache em memória + write-behind.
//  - Arquivo JSON (dev/local): caso contrário, grava em data/db.json.
//
// SEED_DB (base64 de um db.json) semeia a base na PRIMEIRA vez (migração/restauração).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const DB_FILE = join(DATA_DIR, 'db.json');

const USE_PG = !!process.env.DATABASE_URL;

const EMPTY_DB = {
  users: [],
  sessions: [],
  clientes: [],
  tipos_documento: [],
  tipos_pagamento: [],
  documentos: [],
  envios: [],
  agendamentos: [],
  lotes: [],
  _seq: { users: 0, sessions: 0, clientes: 0, tipos_documento: 0, tipos_pagamento: 0, documentos: 0, envios: 0, agendamentos: 0, lotes: 0 },
};

function normalize(j) {
  return { ...EMPTY_DB, ...j, _seq: { ...EMPTY_DB._seq, ...(j._seq || {}) } };
}

// Base inicial: usa SEED_DB (base64) se presente, senão base vazia.
function seedInicial() {
  if (process.env.SEED_DB) {
    try { return normalize(JSON.parse(Buffer.from(process.env.SEED_DB, 'base64').toString('utf8'))); }
    catch { /* SEED_DB inválido */ }
  }
  return structuredClone(EMPTY_DB);
}

let db = structuredClone(EMPTY_DB);
let pool = null;

// -------------------------------------------------------------- arquivo (dev)
function loadFile() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DB_FILE)) {
    const inicial = seedInicial();
    writeFileSync(DB_FILE, JSON.stringify(inicial, null, 2));
    return inicial;
  }
  try { return normalize(JSON.parse(readFileSync(DB_FILE, 'utf8'))); }
  catch { return structuredClone(EMPTY_DB); }
}

// -------------------------------------------------------------- postgres (prod)
async function initPg() {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  await pool.query('CREATE TABLE IF NOT EXISTS app_state (id int PRIMARY KEY, data jsonb NOT NULL)');
  const r = await pool.query('SELECT data FROM app_state WHERE id = 1');
  if (r.rows.length) {
    db = normalize(r.rows[0].data);
    console.log('  → Base carregada do PostgreSQL');
  } else {
    db = seedInicial();
    await pool.query('INSERT INTO app_state (id, data) VALUES (1, $1)', [JSON.stringify(db)]);
    console.log(`  → Base inicial gravada no PostgreSQL${process.env.SEED_DB ? ' (restaurada de SEED_DB)' : ''}`);
  }
}

// write-behind com coalescing e single-flight
let dirty = false;
let flushing = false;
let timer = null;

function schedule() {
  dirty = true;
  if (!timer) timer = setTimeout(flushPg, 200);
}

async function flushPg() {
  timer = null;
  if (flushing || !dirty) return;
  flushing = true; dirty = false;
  try {
    await pool.query('UPDATE app_state SET data = $1 WHERE id = 1', [JSON.stringify(db)]);
  } catch (e) {
    console.error('Falha ao persistir no PostgreSQL:', e.message);
    dirty = true;
  } finally {
    flushing = false;
    if (dirty && !timer) timer = setTimeout(flushPg, 500);
  }
}

// Persiste pendências imediatamente (usado no shutdown).
async function flushNow() {
  if (!USE_PG) return;
  if (timer) { clearTimeout(timer); timer = null; }
  if (dirty || flushing) { dirty = true; await flushPg(); }
}

function persist() {
  if (USE_PG) schedule();
  else writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// -------------------------------------------------------------- API pública
export async function init() {
  if (USE_PG) await initPg();
  else db = loadFile();
}

// Grava pendências e encerra (chamado em SIGTERM/SIGINT, ex.: redeploy).
export async function shutdown() {
  try { await flushNow(); } catch { /* ignore */ }
  try { if (pool) await pool.end(); } catch { /* ignore */ }
}

function nextId(collection) {
  db._seq[collection] = (db._seq[collection] || 0) + 1;
  return db._seq[collection];
}

export const store = {
  all(collection) { return db[collection]; },
  find(collection, id) { return db[collection].find((r) => r.id === Number(id)); },
  where(collection, predicate) { return db[collection].filter(predicate); },
  insert(collection, data) {
    const record = { id: nextId(collection), criado_em: new Date().toISOString(), ...data };
    db[collection].push(record);
    persist();
    return record;
  },
  update(collection, id, data) {
    const record = this.find(collection, id);
    if (!record) return null;
    Object.assign(record, data, { atualizado_em: new Date().toISOString() });
    persist();
    return record;
  },
  remove(collection, id) {
    const idx = db[collection].findIndex((r) => r.id === Number(id));
    if (idx === -1) return false;
    db[collection].splice(idx, 1);
    persist();
    return true;
  },
};

export function seedIfEmpty() {
  let changed = false;
  if (db.tipos_documento.length === 0) {
    ['DAS (Simples Nacional)', 'DARF', 'FGTS', 'GPS (INSS)', 'ISS', 'ICMS', 'Honorários Contábeis', 'Folha de Pagamento', 'Holerite']
      .forEach((descricao) => store.insert('tipos_documento', { descricao }));
    changed = true;
  }
  if (db.tipos_pagamento.length === 0) {
    ['Boleto', 'PIX', 'Débito Automático'].forEach((descricao) => store.insert('tipos_pagamento', { descricao }));
    changed = true;
  }
  return changed;
}
