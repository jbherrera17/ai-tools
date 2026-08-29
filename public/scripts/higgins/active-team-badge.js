(function () {
  if (document.getElementById('higgins-portrait-css')) return;
  var l = document.createElement('link');
  l.id = 'higgins-portrait-css';
  l.rel = 'stylesheet';
  l.href = '/styles/higgins-portrait.css';
  (document.head || document.documentElement).appendChild(l);
})();

// ============================================
// ACTIVE TEAM BADGE — shows in the Higgins card header when a session
// is approved on the current conversation. Also caches the roster in
// `currentActiveTeam` so the working overlay (REQ-004 Phase 4) can
// render the cards without an extra DB round-trip.
// ============================================
let currentActiveTeam = null;  // last-known approved roster for this conversation

function showActiveTeamBadge(roster) {
  const badge = document.getElementById('activeTeamBadge');
  if (!badge || !roster) return;
  const total = (roster.orchestrators?.length || 0) +
                (roster.cross_functional?.length || 0) +
                (roster.exec_team?.length || 0);
  if (total === 0) { badge.classList.remove('shown'); currentActiveTeam = null; return; }
  currentActiveTeam = roster;
  const orchestrators = (roster.orchestrators || []).map((e) => e.display_name || e.slug).join(', ');
  badge.querySelector('.active-team-label').textContent =
    total + ' agent' + (total === 1 ? '' : 's') + ' active';
  badge.title = orchestrators ? 'Active team: ' + orchestrators : 'Team active';
  badge.classList.add('shown');
}
function hideActiveTeamBadge() {
  const badge = document.getElementById('activeTeamBadge');
  if (badge) badge.classList.remove('shown');
  currentActiveTeam = null;
}

async function restoreActiveTeamForConversation(conversationId) {
  if (!conversationId) { hideActiveTeamBadge(); return; }
  try {
    const res = await fetch('/api/team-sessions?conversationId=' + encodeURIComponent(conversationId), {
      headers: authHeaders(),
    });
    if (!res.ok) { hideActiveTeamBadge(); return; }
    const data = await res.json();
    if (data?.session?.roster) {
      showActiveTeamBadge(data.session.roster);
    } else {
      hideActiveTeamBadge();
    }
  } catch (err) {
    console.warn('[higgins] restoreActiveTeam failed', err);
    hideActiveTeamBadge();
  }
}

// ============================================
// MODEL PICKER — compact grouped <select> in the composer meta row.
// Fetches GET /api/models with the same bearer as chat, persists last
// pick in localStorage, and includes `model` on POST /api/chat.
// This file already loads after chat.js in higgins2.html.
// ============================================

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

function ensureModelSelect() {
  let select = document.getElementById('higginsModelSelect');
  if (select) return select;
  const meta = document.querySelector('.higgins-input-area .input-meta');
  if (!meta) return null;
  if (!document.getElementById('higgins-model-select-style')) {
    const style = document.createElement('style');
    style.id = 'higgins-model-select-style';
    style.textContent =
      '.model-select{max-width:11.5rem;font:inherit;font-size:0.625rem;color:var(--text-muted);' +
      'background:var(--surface-overlay,transparent);border:1px solid var(--border-default,#ddd);' +
      'border-radius:4px;padding:1px 4px;cursor:pointer;}' +
      '.model-select:hover,.model-select:focus{color:var(--agent-accent,#06b6d4);' +
      'border-color:var(--agent-accent,#06b6d4);outline:none;}';
    document.head.appendChild(style);
  }
  select = document.createElement('select');
  select.id = 'higginsModelSelect';
  select.className = 'model-select';
  select.setAttribute('aria-label', 'Chat model');
  select.title = 'Chat model';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Loading models…';
  select.appendChild(placeholder);
  const hint = document.getElementById('inputHint');
  const sibling = hint ? hint.nextElementSibling : null;
  if (sibling) sibling.replaceWith(select);
  else meta.appendChild(select);
  return select;
}

async function loadModelPicker() {
  const select = ensureModelSelect();
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
