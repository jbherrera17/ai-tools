// Higgins 2.0 model picker. Loads GET /api/models with the same bearer as
// chat, persists the last pick, and includes `model` on POST /api/chat.
// Loaded after chat.js so it can wrap addMessage for the bubble badge.

const HIGGINS_MODEL_KEY = 'higgins.model';
let selectedModel = null;

function currentModelLabel() {
  const sel = document.getElementById('higginsModelSelect');
  if (sel && sel.selectedIndex >= 0) {
    const opt = sel.options[sel.selectedIndex];
    const label = (opt && opt.textContent) ? opt.textContent.trim() : '';
    if (label && sel.value) return label;
  }
  return 'Higgins';
}

async function loadModelPicker() {
  const select = document.getElementById('higginsModelSelect');
  if (!select) return;
  try {
    const headers = typeof authHeaders === 'function'
      ? authHeaders()
      : { 'Content-Type': 'application/json' };
    const res = await fetch('/api/models', { headers });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const groups = Array.isArray(data?.models) ? data.models : [];
    select.innerHTML = '';
    const allowed = new Set();
    for (const g of groups) {
      const og = document.createElement('optgroup');
      og.label = g.group || 'Other';
      for (const m of (g.models || [])) {
        if (!m || !m.id) continue;
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name || m.id;
        if (m.description) opt.title = m.description;
        og.appendChild(opt);
        allowed.add(m.id);
      }
      if (og.childElementCount) select.appendChild(og);
    }
    const saved = localStorage.getItem(HIGGINS_MODEL_KEY);
    const pick = (saved && allowed.has(saved)) ? saved : data.defaultModel;
    if (pick && allowed.has(pick)) {
      select.value = pick;
      selectedModel = pick;
      localStorage.setItem(HIGGINS_MODEL_KEY, pick);
    } else {
      selectedModel = null;
    }
    select.addEventListener('change', () => {
      selectedModel = select.value || null;
      if (selectedModel) localStorage.setItem(HIGGINS_MODEL_KEY, selectedModel);
      else localStorage.removeItem(HIGGINS_MODEL_KEY);
    });
  } catch (err) {
    console.warn('[higgins] model catalog fetch failed; omitting model from chat', err);
    selectedModel = null;
    select.style.display = 'none';
  }
}

const _fetch = window.fetch.bind(window);
window.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  const path = typeof url === 'string' ? url.split('?')[0] : '';
  if (path === '/api/chat' && init && typeof init.body === 'string' && selectedModel) {
    try {
      const body = JSON.parse(init.body);
      if (body && typeof body === 'object' && !body.model) {
        body.model = selectedModel;
        init = Object.assign({}, init, { body: JSON.stringify(body) });
      }
    } catch (err) {
      /* leave body as-is */
    }
  }
  return _fetch(input, init);
};

if (typeof addMessage === 'function') {
  const _addMessage = addMessage;
  addMessage = function (role, html, sourceText) {
    const msg = _addMessage(role, html, sourceText);
    if (role === 'agent' && msg) {
      const badge = msg.querySelector('.model-badge');
      if (badge) badge.textContent = currentModelLabel();
    }
    return msg;
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadModelPicker);
} else {
  loadModelPicker();
}
