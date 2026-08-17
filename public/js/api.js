// Cliente HTTP simples para a API REST.
const API = {
  async request(method, path, body, isForm = false) {
    const opts = { method, headers: {} };
    if (body && !isForm) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    } else if (isForm) {
      opts.body = body; // FormData
    }
    const res = await fetch(`/api${path}`, opts);
    if (res.status === 401 && !path.startsWith('/auth/')) { location.href = '/login.html'; throw new Error('Sessão expirada.'); }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
    return data;
  },
  get(p) { return this.request('GET', p); },
  post(p, b) { return this.request('POST', p, b); },
  put(p, b) { return this.request('PUT', p, b); },
  del(p) { return this.request('DELETE', p); },
  upload(p, formData) { return this.request('POST', p, formData, true); },
};
