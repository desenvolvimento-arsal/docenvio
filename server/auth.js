// Autenticação simples: hash de senha (scrypt nativo), sessões por cookie httpOnly.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashSenha(senha) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(senha), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verificarSenha(senha, armazenado) {
  if (!armazenado || !armazenado.includes(':')) return false;
  const [salt, hash] = armazenado.split(':');
  const test = scryptSync(String(senha), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(test, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function novoToken() {
  return randomBytes(32).toString('hex');
}

// Extrai o token do cookie `sid` ou do header Authorization: Bearer.
export function tokenDaRequisicao(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)sid=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// View pública do usuário (sem hash de senha).
export function userView(u) {
  if (!u) return null;
  return { id: u.id, nome: u.nome, email: u.email, role: u.role, ativo: u.ativo, criado_em: u.criado_em };
}

// Middleware que exige usuário autenticado; injeta req.user.
export function requireAuth(store) {
  return (req, res, next) => {
    const token = tokenDaRequisicao(req);
    if (!token) return res.status(401).json({ error: 'Não autenticado.' });
    const sess = store.where('sessions', (s) => s.token === token)[0];
    if (!sess) return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
    const user = store.find('users', sess.user_id);
    if (!user || !user.ativo) return res.status(401).json({ error: 'Conta inativa.' });
    req.user = user;
    req.sessionToken = token;
    next();
  };
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
  next();
}
