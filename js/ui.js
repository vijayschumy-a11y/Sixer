/* Sixer — UI helpers: toast, modal sheet, pickers, small components. */
(function () {
  const APP = (window.Sixer = window.Sixer || {});

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg, kind) {
    const root = $('#toast-root');
    const t = document.createElement('div');
    t.className = 'toast';
    if (kind === 'err') t.style.borderColor = 'var(--red)';
    t.textContent = msg;
    root.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = '.3s'; setTimeout(() => t.remove(), 300); }, 1900);
  }

  function initials(name) {
    return (name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  }

  function avatar(player, cls = '') {
    if (!player) return `<div class="avatar ${cls}">?</div>`;
    if (player.photo) return `<img class="avatar ${cls}" src="${player.photo}" alt="">`;
    return `<div class="avatar ${cls}">${esc(initials(player.name))}</div>`;
  }

  function pname(pid) {
    const p = APP.store.Players.get(pid);
    return p ? p.name : '—';
  }

  /* Bottom sheet modal. content = HTML string. Returns the overlay element. */
  function sheet(title, contentHTML, opts = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'backdrop';
    overlay.innerHTML = `<div class="sheet">
      <div class="sheet-handle"></div>
      ${title ? `<h3>${esc(title)}</h3>` : ''}
      <div class="sheet-body">${contentHTML}</div>
    </div>`;
    $('#modal-root').appendChild(overlay);
    const close = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay && opts.dismissable !== false) close(); };
    return { overlay, close, body: overlay.querySelector('.sheet-body') };
  }

  /* Single-choice picker. items=[{id,label,sub,html}], returns id via cb. */
  function pick(title, items, cb, opts = {}) {
    const html = `<div class="opt-list">` + items.map((it) =>
      `<button class="opt ${it.selected ? 'sel' : ''}" data-id="${esc(it.id)}">
         ${it.html || `<div style="flex:1"><div>${esc(it.label)}</div>${it.sub ? `<div class="small muted">${esc(it.sub)}</div>` : ''}</div>`}
       </button>`).join('') +
      (opts.allowNone ? `<button class="opt" data-id="__none__">— None —</button>` : '') +
      `</div>`;
    const s = sheet(title, html);
    $$('.opt', s.overlay).forEach((b) => b.onclick = () => {
      const id = b.dataset.id;
      s.close();
      cb(id === '__none__' ? null : id);
    });
    return s;
  }

  function confirm(title, msg, onYes, yesLabel = 'Confirm', danger = false) {
    const s = sheet(title, `<p class="muted">${esc(msg)}</p>
      <div class="cap-grid" style="margin-top:12px">
        <button class="btn ${danger ? 'danger' : 'primary'}" id="cf-yes">${esc(yesLabel)}</button>
        <button class="btn" id="cf-no">Cancel</button>
      </div>`);
    $('#cf-yes', s.overlay).onclick = () => { s.close(); onYes(); };
    $('#cf-no', s.overlay).onclick = () => s.close();
  }

  function prompt(title, label, value, onOk, ph = '') {
    const s = sheet(title, `<label class="field"><span>${esc(label)}</span>
      <input id="pr-input" value="${esc(value || '')}" placeholder="${esc(ph)}"></label>
      <button class="btn primary block" id="pr-ok">Save</button>`);
    const inp = $('#pr-input', s.overlay);
    inp.focus();
    $('#pr-ok', s.overlay).onclick = () => { const v = inp.value.trim(); s.close(); onOk(v); };
    inp.onkeydown = (e) => { if (e.key === 'Enter') $('#pr-ok', s.overlay).click(); };
  }

  function statTile(value, label) {
    return `<div class="stat-tile"><div class="v">${value}</div><div class="l">${esc(label)}</div></div>`;
  }

  function fmtDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtDay(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  APP.ui = { $, $$, esc, toast, initials, avatar, pname, sheet, pick, confirm, prompt, statTile, fmtDate, fmtDay, download };
  APP.toast = toast;
})();
