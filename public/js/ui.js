// Componentes de UI reutilizáveis: toast, modal, confirm, máscaras, helpers.

const UI = {
  // -------- helpers ----------------------------------------------------
  esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  },
  fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  },
  fmtSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  },
  badge(status) {
    const labels = {
      enviado: 'Enviado', pendente: 'Enviando', falha: 'Falha', nao_enviado: 'Não enviado', ativo: 'Ativo',
      aberta: 'Em aberto', paga: 'Paga', vencida: 'Vencida',
    };
    return `<span class="badge ${status}">${labels[status] || status}</span>`;
  },
  initials(nome = '') {
    return nome.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  },
  emptyState(iconName, text, ctaHtml = '') {
    return `<div class="empty">${icon(iconName)}<p>${text}</p>${ctaHtml}</div>`;
  },

  // -------- toast ------------------------------------------------------
  toast(type, title, msg = '') {
    const ic = { success: 'check', error: 'alert', info: 'info', warning: 'alert' }[type] || 'info';
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `${icon(ic)}<div><div class="t-title">${this.esc(title)}</div>${msg ? `<div class="t-msg">${this.esc(msg)}</div>` : ''}</div>`;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; el.style.transition = 'all .2s'; setTimeout(() => el.remove(), 220); }, 4000);
  },

  // -------- modal ------------------------------------------------------
  modal({ title, body, footer, wide = false }) {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="modal ${wide ? 'lg' : ''}">
        <div class="modal-head"><h3>${this.esc(title)}</h3><button class="icon-btn" data-close>${icon('x')}</button></div>
        <div class="modal-body">${body}</div>
        <div class="modal-foot">${footer}</div>
      </div>`;
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onEsc); };
    const onEsc = (e) => { if (e.key === 'Escape') close(); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onEsc);
    document.body.appendChild(overlay);
    return { overlay, close, el: overlay.querySelector('.modal') };
  },

  confirm({ title, message, danger = true, confirmLabel = 'Excluir' }) {
    return new Promise((resolve) => {
      const m = this.modal({
        title,
        body: `<p style="color:var(--text-2)">${this.esc(message)}</p>`,
        footer: `<button class="btn secondary" data-no>Cancelar</button><button class="btn ${danger ? 'danger' : ''}" data-yes>${this.esc(confirmLabel)}</button>`,
      });
      m.el.querySelector('[data-no]').onclick = () => { m.close(); resolve(false); };
      m.el.querySelector('[data-yes]').onclick = () => { m.close(); resolve(true); };
    });
  },

  // -------- máscaras ---------------------------------------------------
  maskCNPJ(v) {
    return v.replace(/\D/g, '').slice(0, 14)
      .replace(/^(\d{2})(\d)/, '$1.$2')
      .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2')
      .replace(/(\d{4})(\d)/, '$1-$2');
  },
  maskMoney(v) {
    let d = String(v).replace(/\D/g, '');
    if (!d) return '';
    d = (parseInt(d, 10) / 100).toFixed(2); // centavos -> reais
    return d.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  },
  maskPhone(v) {
    const d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d.replace(/^(\d*)/, '($1');
    if (d.length <= 6) return d.replace(/^(\d{2})(\d*)/, '($1) $2');
    if (d.length <= 10) return d.replace(/^(\d{2})(\d{4})(\d*)/, '($1) $2-$3');
    return d.replace(/^(\d{2})(\d{5})(\d*)/, '($1) $2-$3');
  },
  bindMask(input, fn) {
    input.addEventListener('input', () => { input.value = fn(input.value); });
  },
};
