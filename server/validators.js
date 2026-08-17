// Validações de domínio: CNPJ, telefone WhatsApp (E.164/BR), descrições.

/** Remove tudo que não for dígito. */
export function onlyDigits(v = '') {
  return String(v).replace(/\D/g, '');
}

/** Valida CNPJ pelos dígitos verificadores (módulo 11). */
export function isValidCNPJ(value) {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false; // todos iguais

  const calc = (base) => {
    let pos = base.length - 7;
    let sum = 0;
    for (let i = base.length; i >= 1; i--) {
      sum += Number(base[base.length - i]) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };

  const d1 = calc(cnpj.slice(0, 12));
  const d2 = calc(cnpj.slice(0, 12) + d1);
  return cnpj.endsWith(`${d1}${d2}`);
}

/** Formata CNPJ para exibição: 00.000.000/0000-00 */
export function formatCNPJ(value) {
  const c = onlyDigits(value).padStart(14, '0').slice(0, 14);
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

/**
 * Normaliza telefone para E.164 Brasil: +55 + DDD(2) + numero(8-9).
 * Aceita entradas com/sem +55, com máscara. Retorna null se inválido.
 */
export function normalizePhoneBR(value) {
  let d = onlyDigits(value);
  if (!d) return null;
  // remove DDI 55 se presente
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  // agora deve ter DDD(2) + 8 ou 9 dígitos = 10 ou 11
  if (d.length !== 10 && d.length !== 11) return null;
  const ddd = d.slice(0, 2);
  if (ddd[0] === '0') return null;
  return `+55${d}`;
}

export function isValidPhoneBR(value) {
  return normalizePhoneBR(value) !== null;
}

/** Telefone só com dígitos para link wa.me (ex: 5511999998888). */
export function phoneForWaMe(e164) {
  return onlyDigits(e164);
}

export function isNonEmpty(v, max = 120) {
  return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;
}
