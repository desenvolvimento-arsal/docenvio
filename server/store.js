// Persistência simples baseada em arquivo JSON — sem dependências nativas.
// Adequado para um sistema institucional simples / protótipo com envio mockado.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const DB_FILE = join(DATA_DIR, 'db.json');

const EMPTY_DB = {
  users: [],
  sessions: [],
  clientes: [],
  tipos_documento: [],
  tipos_pagamento: [],
  documentos: [],
  envios: [],
  _seq: { users: 0, sessions: 0, clientes: 0, tipos_documento: 0, tipos_pagamento: 0, documentos: 0, envios: 0 },
};

function ensureDb() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DB_FILE)) writeFileSync(DB_FILE, JSON.stringify(EMPTY_DB, null, 2));
}

function load() {
  ensureDb();
  try {
    const db = JSON.parse(readFileSync(DB_FILE, 'utf8'));
    // garante todas as coleções mesmo em bases antigas
    return { ...EMPTY_DB, ...db, _seq: { ...EMPTY_DB._seq, ...(db._seq || {}) } };
  } catch {
    return structuredClone(EMPTY_DB);
  }
}

let db = load();

function persist() {
  writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function nextId(collection) {
  db._seq[collection] = (db._seq[collection] || 0) + 1;
  return db._seq[collection];
}

export const store = {
  all(collection) {
    return db[collection];
  },
  find(collection, id) {
    return db[collection].find((r) => r.id === Number(id));
  },
  where(collection, predicate) {
    return db[collection].filter(predicate);
  },
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
  // recarrega do disco (útil em testes)
  _reload() {
    db = load();
  },
};

export function seedIfEmpty() {
  let changed = false;
  // Tipos de guia (armazenados na coleção tipos_documento)
  if (db.tipos_documento.length === 0) {
    ['DAS (Simples Nacional)', 'DARF', 'FGTS', 'GPS (INSS)', 'ISS', 'ICMS', 'Honorários Contábeis', 'Folha de Pagamento', 'Holerite']
      .forEach((descricao) => store.insert('tipos_documento', { descricao }));
    changed = true;
  }
  // Formas de pagamento
  if (db.tipos_pagamento.length === 0) {
    ['Boleto', 'PIX', 'Débito Automático'].forEach((descricao) =>
      store.insert('tipos_pagamento', { descricao })
    );
    changed = true;
  }
  return changed;
}
