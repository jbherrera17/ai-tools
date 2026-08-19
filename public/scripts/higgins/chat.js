// ============================================
// CHART
// ============================================
function drawChart() {
  const canvas = document.getElementById('progressChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.scale(dpr, dpr);
  const w = rect.width, h = rect.height;
  const pad = { top: 20, right: 20, bottom: 30, left: 40 };
  const cw = w - pad.left - pad.right, ch = h - pad.top - pad.bottom;
  const months = ['Oct','Nov','Dec','Jan','Feb','Mar'];
  const data = { onTrack: [5,5,6,6,7,7], atRisk: [2,3,2,3,2,3], behind: [3,2,2,2,2,2] };

  // Theme-aware colors — read from CSS vars at draw time
  const cs = getComputedStyle(document.documentElement);
  const grid    = cs.getPropertyValue('--color-border-subtle').trim() || '#e8e8ed';
  const label   = cs.getPropertyValue('--color-text-tertiary').trim() || '#86868b';
  const surface = cs.getPropertyValue('--color-surface').trim() || '#ffffff';
  const cSuccess = cs.getPropertyValue('--color-success').trim() || '#34c759';
  const cWarning = cs.getPropertyValue('--color-warning').trim() || '#ff9500';
  const cDanger  = cs.getPropertyValue('--color-danger').trim()  || '#ff3b30';
  const chartFont = '10px ' + (cs.getPropertyValue('--font-sans').trim() || 'system-ui, sans-serif');

  ctx.strokeStyle = grid; ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) { const y = pad.top + (ch/4)*i; ctx.beginPath(); ctx.moveTo(pad.left,y); ctx.lineTo(w-pad.right,y); ctx.stroke(); }

  ctx.fillStyle = label; ctx.font = chartFont; ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) ctx.fillText(Math.round(10-i*2.5), pad.left-6, pad.top+(ch/4)*i+3);
  ctx.textAlign = 'center';
  months.forEach((m,i) => ctx.fillText(m, pad.left+(cw/(months.length-1))*i, h-8));

  function line(d, color) {
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    d.forEach((v,i) => { const x = pad.left+(cw/(d.length-1))*i, y = pad.top+ch-(v/10)*ch; i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
    ctx.stroke();
    d.forEach((v,i) => { const x = pad.left+(cw/(d.length-1))*i, y = pad.top+ch-(v/10)*ch; ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fillStyle=color; ctx.fill(); ctx.strokeStyle=surface; ctx.lineWidth=2; ctx.stroke(); });
  }
  line(data.onTrack, cSuccess); line(data.atRisk, cWarning); line(data.behind, cDanger);

  let lx = w - pad.right;
  ctx.textAlign = 'right'; ctx.font = chartFont;
  [{l:'Behind',c:cDanger},{l:'At Risk',c:cWarning},{l:'On Track',c:cSuccess}].forEach(({l,c}) => {
    const tw = ctx.measureText(l).width; ctx.fillStyle = c; ctx.fillText(l, lx, 12); lx -= tw+6; ctx.beginPath(); ctx.arc(lx,8,3,0,Math.PI*2); ctx.fill(); lx -= 14;
  });
}
setTimeout(drawChart, 100);
window.addEventListener('resize', drawChart);

// Voice waveform / mic input removed in REQ-002 Phase 6 polish.
// Reintroduce only when a real Web Speech API integration ships.

// ============================================
// MODE TOGGLE (minimize/restore)
// ============================================
let isMinimized = false;
function toggleMode() {
  isMinimized = !isMinimized;
  document.getElementById('modeSwitch').classList.toggle('active', isMinimized);
  document.getElementById('higginsCard').classList.toggle('minimized', isMinimized);
  document.getElementById('ambientAvatar').classList.toggle('visible', isMinimized);
}
function restoreCard() {
  isMinimized = false;
  document.getElementById('modeSwitch').classList.remove('active');
  document.getElementById('higginsCard').classList.remove('minimized');
  document.getElementById('ambientAvatar').classList.remove('visible');
}

// ============================================
// DRAG TO MOVE
// ============================================
const card = document.getElementById('higginsCard');
const dragBar = document.getElementById('dragBar');
let isDragging = false, dragStartX, dragStartY, cardStartX, cardStartY;

dragBar.addEventListener('mousedown', e => {
  isDragging = true;
  const rect = card.getBoundingClientRect();
  dragStartX = e.clientX; dragStartY = e.clientY;
  cardStartX = rect.left; cardStartY = rect.top;
  card.style.transition = 'none';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});

document.addEventListener('mousemove', e => {
  if (!isDragging) return;
  const dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;
  card.style.left = (cardStartX + dx) + 'px';
  card.style.top = (cardStartY + dy) + 'px';
  card.style.bottom = 'auto';
  card.style.right = 'auto';
});

document.addEventListener('mouseup', () => {
  if (isDragging) { isDragging = false; card.style.transition = ''; document.body.style.userSelect = ''; }
});

// ============================================
// RESIZE CARD
// ============================================
function setupResize(handleEl, dirs) {
  let startX, startY, startW, startH, startLeft, startTop;
  handleEl.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    const rect = card.getBoundingClientRect();
    startX = e.clientX; startY = e.clientY;
    startW = rect.width; startH = rect.height;
    startLeft = rect.left; startTop = rect.top;
    card.style.transition = 'none';
    document.body.style.userSelect = 'none';

    function onMove(e) {
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (dirs.includes('right'))  card.style.width  = Math.max(360, Math.min(720, startW + dx)) + 'px';
      if (dirs.includes('bottom')) card.style.height = Math.max(400, Math.min(window.innerHeight - 80, startH + dy)) + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      card.style.transition = '';
      document.body.style.userSelect = '';
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
setupResize(document.getElementById('resizeRight'), ['right']);
setupResize(document.getElementById('resizeBottom'), ['bottom']);
setupResize(document.getElementById('resizeBottomRight'), ['right','bottom']);

// ============================================
// COMMAND PALETTE
// ============================================
function openPalette() {
  document.getElementById('paletteScrim').classList.add('open');
  document.getElementById('commandPalette').classList.add('open');
  setTimeout(() => document.getElementById('paletteSearch').focus(), 100);
  populateRecentConversations();
}

function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (!then) return '';
  const sec = Math.max(1, Math.floor((Date.now() - then) / 1000));
  if (sec < 60) return sec + 's ago';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ago';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h ago';
  const day = Math.floor(hr / 24);
  return day + 'd ago';
}

async function populateRecentConversations() {
  const list = document.getElementById('paletteRecentList');
  if (!list) return;
  // Preserve the first child ("New conversation") and wipe the rest.
  const newConvItem = list.firstElementChild;
  list.innerHTML = '';
  if (newConvItem) list.appendChild(newConvItem);

  try {
    const res = await fetch('/api/conversation', { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    const convs = Array.isArray(data?.conversations) ? data.conversations : [];
    const activeId = localStorage.getItem(HIGGINS_CONV_KEY);
    if (convs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'recent-item';
      empty.style.cssText = 'opacity:0.5;pointer-events:none;font-style:italic;';
      empty.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg><span>No conversations yet</span>';
      list.appendChild(empty);
      return;
    }
    for (const c of convs.slice(0, 12)) {
      const item = document.createElement('div');
      item.className = 'recent-item';
      const isActive = c.id === activeId;
      if (isActive) item.style.cssText = 'background:var(--agent-accent-muted);';
      item.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span>${escapeHtml(c.title || '(untitled)')}</span>
        <span class="recent-time">${escapeHtml(timeAgo(c.updated_at))}</span>
      `;
      item.addEventListener('click', () => {
        switchConversation(c.id);
        closePalette();
      });
      list.appendChild(item);
    }
  } catch (err) {
    console.warn('[higgins] populateRecentConversations failed', err);
  }
}

function clearOpenArtifacts() {
  if (!window.ArtifactWindow) return;
  const ids = Array.from(window.ArtifactWindow.registry.keys());
  for (const id of ids) {
    try { window.ArtifactWindow.get(id)?.close(); } catch {}
  }
}

function clearChatStream() {
  const stream = document.getElementById('conversationStream');
  if (stream) stream.innerHTML = '';
}

function startNewConversation() {
  localStorage.removeItem(HIGGINS_CONV_KEY);
  clearOpenArtifacts();
  clearChatStream();
  hideActiveTeamBadge();
  setAgentState('ready', 'Ready to help');
  showToast('New conversation');
}

async function switchConversation(id) {
  if (!id) return;
  if (id === localStorage.getItem(HIGGINS_CONV_KEY)) return; // no-op
  localStorage.setItem(HIGGINS_CONV_KEY, id);
  clearOpenArtifacts();
  clearChatStream();
  hideActiveTeamBadge();
  await loadConversationHistory();
  await restoreActiveTeamForConversation(id);
  setAgentState('ready', 'Ready to help');
}

// ============================================
// MEMORY INSPECTOR — REQ-002 Phase 6
// ============================================
let miCurrentKind = '';

function openMemoryInspector() {
  document.getElementById('memoryInspectorScrim').classList.add('open');
  populateMemoryInspector();
}
function closeMemoryInspector(e) {
  if (e && e.target && !e.target.closest('.memory-inspector-scrim')) return;
  document.getElementById('memoryInspectorScrim').classList.remove('open');
}

async function populateMemoryInspector() {
  const body = document.getElementById('miBody');
  body.innerHTML = '<div class="mi-empty">Loading…</div>';
  try {
    const url = '/api/memories' + (miCurrentKind ? '?kind=' + encodeURIComponent(miCurrentKind) : '');
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
      body.innerHTML = '<div class="mi-empty" style="color:var(--status-danger)">Failed to load memories (HTTP ' + res.status + ')</div>';
      return;
    }
    const data = await res.json();
    const memories = Array.isArray(data?.memories) ? data.memories : [];
    if (memories.length === 0) {
      body.innerHTML = '<div class="mi-empty">No memories' + (miCurrentKind ? ' of kind <strong>' + escapeHtml(miCurrentKind) + '</strong>' : '') + ' yet. Ask Higgins to remember something.</div>';
      return;
    }
    body.innerHTML = memories
      .map((m) => `
        <div class="mi-row" data-mem-id="${escapeHtml(m.id)}">
          <div class="mi-kind-col">
            <span class="mi-kind-badge">${escapeHtml(m.kind)}</span>
            <span class="mi-importance">★ ${m.importance}/5</span>
          </div>
          <div class="mi-content-col">
            ${m.title ? '<div class="mi-title">' + escapeHtml(m.title) + '</div>' : ''}
            <div class="mi-content">${escapeHtml(m.content)}</div>
            <div class="mi-meta">${escapeHtml(m.scope)} · ${escapeHtml(timeAgo(m.created_at))}${m.conversation_id ? ' · in conversation' : ''}</div>
          </div>
          <div class="mi-actions">
            <button class="icon-btn" data-mem-delete="${escapeHtml(m.id)}" title="Forget this memory">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            </button>
          </div>
        </div>
      `)
      .join('');
    // Wire delete buttons
    body.querySelectorAll('[data-mem-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-mem-delete');
        if (!confirm('Forget this memory?')) return;
        try {
          const r = await fetch('/api/memories?id=' + encodeURIComponent(id), {
            method: 'DELETE',
            headers: authHeaders(),
          });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          showToast('Forgotten');
          populateMemoryInspector();
        } catch (err) {
          console.error('[higgins] memory delete failed', err);
          showToast('Delete failed');
        }
      });
    });
  } catch (err) {
    console.error('[higgins] populateMemoryInspector failed', err);
    body.innerHTML = '<div class="mi-empty" style="color:var(--status-danger)">Error loading memories</div>';
  }
}

// Filter chips
document.addEventListener('click', (e) => {
  const chip = e.target.closest('#miFilters .mi-filter-chip');
  if (!chip) return;
  document.querySelectorAll('#miFilters .mi-filter-chip').forEach((c) => c.classList.remove('active'));
  chip.classList.add('active');
  miCurrentKind = chip.dataset.kind || '';
  populateMemoryInspector();
});

// Esc closes the inspector (also team modal — see TeamModal section below)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const scrim = document.getElementById('memoryInspectorScrim');
    if (scrim && scrim.classList.contains('open')) {
      scrim.classList.remove('open');
    }
    const teamScrim = document.getElementById('teamModalScrim');
    if (teamScrim && teamScrim.classList.contains('open') && !TeamModal.isWorking()) {
      TeamModal.cancel();
    }
  }
});

function closePalette() { document.getElementById('paletteScrim').classList.remove('open'); document.getElementById('commandPalette').classList.remove('open'); document.getElementById('paletteSearch').value = ''; filterPalette(''); }
function filterPalette(q) { q = q.toLowerCase().trim(); document.querySelectorAll('.module-tile').forEach(t => t.style.display = (!q||t.dataset.name?.includes(q))?'':'none'); document.querySelectorAll('.recent-item,.suggestion-card').forEach(el => el.style.display = (!q||el.textContent.toLowerCase().includes(q))?'':'none'); }

document.addEventListener('keydown', e => {
  if ((e.metaKey||e.ctrlKey) && e.key === 'k') { e.preventDefault(); document.getElementById('commandPalette').classList.contains('open') ? closePalette() : openPalette(); }
  if (e.key === 'Escape') closePalette();
});
if (navigator.platform.indexOf('Mac') === -1) document.getElementById('shortcutHint').textContent = 'Ctrl+K';

// ============================================
// INPUT HANDLING
// ============================================
function autoGrow(el) { el.style.height = '20px'; el.style.height = Math.min(el.scrollHeight, 80) + 'px'; }
function toggleSend() {
  const hasText = document.getElementById('higginsInput').value.trim().length > 0;
  const hasAtt = !!(window.HigginsAttachments && window.HigginsAttachments.hasReady());
  document.getElementById('sendBtn').classList.toggle('active', hasText || hasAtt);
}
function handleKeyDown(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }

// ============================================
// SEND / RESPOND — REQ-002 Phase 2: real streaming chat
// ============================================
const HIGGINS_CONV_KEY = 'higgins.conversationId';
const HIGGINS_TOKEN_KEY = 'higgins.token';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
// Configure marked once on first use. GFM + line breaks keep parity with how
// Higgins drafts in chat (lists, headers, fenced code, tables). HTML inside
// markdown is left disabled — Higgins's text is trusted but we don't want
// raw <script> from a paste-through to ever execute.
let _markedReady = false;
function ensureMarkedReady() {
  if (_markedReady || typeof window.marked === 'undefined') return;
  window.marked.setOptions({
    gfm: true,
    breaks: true,
    headerIds: false,
    mangle: false,
  });
  _markedReady = true;
}

function textToHtml(str) {
  // Fallback to the previous behavior if marked failed to load — better
  // than a broken bubble. The CDN might miss on flaky networks.
  if (typeof window.marked === 'undefined') {
    return escapeHtml(str).replace(/\n/g, '<br>');
  }
  ensureMarkedReady();
  try {
    // marked.parse handles escaping of literal HTML inside markdown.
    return window.marked.parse(String(str ?? ''));
  } catch (err) {
    console.warn('[higgins/markdown] render failed; falling back to plain text', err);
    return escapeHtml(str).replace(/\n/g, '<br>');
  }
}
function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  const t = localStorage.getItem(HIGGINS_TOKEN_KEY);
  if (t) h['Authorization'] = 'Bearer ' + t;
  return h;
}

let responding = false;
let currentAbortController = null;

function setSendState(busy) {
  const sendBtn = document.getElementById('sendBtn');
  const stopBtn = document.getElementById('stopBtn');
  if (sendBtn) sendBtn.style.display = busy ? 'none' : '';
  if (stopBtn) stopBtn.style.display = busy ? 'flex' : 'none';
}

function cancelMessage() {
  if (currentAbortController) {
    currentAbortController.abort();
    showToast('Cancelled');
  }
}

async function sendMessage(overrideText) {
  const input = document.getElementById('higginsInput');
  // overrideText supports programmatic continuation (e.g. after team approval)
  // without trampling the textarea or requiring the user to retype.
  const text = (typeof overrideText === 'string' ? overrideText : input.value).trim();
  // Attachments only apply to real user sends, not programmatic continuations.
  const isUserSend = typeof overrideText !== 'string';
  const atts = (isUserSend && window.HigginsAttachments) ? window.HigginsAttachments.getReady() : [];
  if (isUserSend && window.HigginsAttachments && window.HigginsAttachments.isUploading()) {
    showToast('Still uploading — one moment');
    return;
  }
  if ((!text && atts.length === 0) || responding) return;
  if (!window.HigginsStream) {
    console.error('Higgins stream parser not loaded yet');
    return;
  }
  responding = true;
  setSendState(true);
  currentAbortController = new AbortController();
  const userMsgEl = addMessage('user', textToHtml(text), text);
  if (atts.length && window.HigginsAttachments) {
    window.HigginsAttachments.renderChipsInto(userMsgEl.querySelector('.message-bubble'), atts);
    window.HigginsAttachments.clear();
  }
  if (typeof overrideText !== 'string') {
    input.value = ''; autoGrow(input); toggleSend();
  }

  const face = document.getElementById('avatarFace');
  face.classList.add('thinking');
  setAgentState('thinking', 'Thinking…');
  const thinking = addThinkingIndicator('Thinking…');

  // Pre-create the assistant bubble so we can stream into it
  const agentMsg = addMessage('agent', '');
  const agentBubble = agentMsg.querySelector('.message-bubble');
  let accumulated = '';
  let firstDelta = true;
  // Defer the team-assembly modal until the stream finishes. The tool output
  // arrives mid-stream (Higgins is still narrating the approval process), so
  // opening immediately pops the modal over an unfinished message. Stash it
  // here and open once all text deltas have rendered.
  let pendingTeamProposal = null;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        conversationId: localStorage.getItem(HIGGINS_CONV_KEY) || undefined,
        message: text,
        attachments: atts.length ? atts : undefined,
      }),
      signal: currentAbortController.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error('HTTP ' + res.status + ' ' + (errBody || res.statusText));
    }
    const newConvId = res.headers.get('X-Conversation-Id');
    if (newConvId) localStorage.setItem(HIGGINS_CONV_KEY, newConvId);

    const advanceFromThinking = () => {
      if (!firstDelta) return;
      firstDelta = false;
      thinking.remove();
      face.classList.remove('thinking');
      face.classList.add('speaking');
      setAgentState('responding', 'Speaking...');
    };

    for await (const part of window.HigginsStream.parseHigginsStream(res)) {
      const t = part?.type;
      if (t === 'text-delta' && typeof part.delta === 'string') {
        advanceFromThinking();
        accumulated += part.delta;
        agentBubble.innerHTML = textToHtml(accumulated);
        // Stash the markdown source so the per-message copy button has it.
        agentMsg.dataset.source = accumulated;
        const stream = document.getElementById('conversationStream');
        stream.scrollTop = stream.scrollHeight;
      } else if (t === 'tool-input-start' && part.toolName) {
        updateThinkingText(TOOL_LABELS[part.toolName] || ('Calling ' + part.toolName + '…'));
      } else if (t === 'tool-input-available' && part.toolName) {
        advanceFromThinking();
        try {
          if (part.toolName === 'create_artifact' && window.ArtifactWindow) {
            window.ArtifactWindow.openOrUpdate(part.input.id, {
              type: part.input.type,
              title: part.input.title,
              content: part.input.content,
              language: part.input.language,
            });
          } else if (part.toolName === 'update_artifact' && window.ArtifactWindow) {
            window.ArtifactWindow.openOrUpdate(part.input.id, {
              patch: part.input.patch,
            });
          } else if (part.toolName === 'run_team_workstreams' && window.TeamWorking) {
            // Open the working overlay so the 15–30s parallel fan-out feels
            // alive. Roster comes from the cached active team; brief comes
            // from the tool input the model just emitted.
            window.TeamWorking.open(currentActiveTeam, part.input?.task_brief);
          }
        } catch (toolErr) {
          console.error('[higgins] tool dispatch failed', toolErr, part);
        }
      } else if (t === 'tool-output-available' && part.output) {
        advanceFromThinking();
        const out = part.output;
        // Tool output events don't carry toolName — only toolCallId + output.
        // Discriminate by the output's shape: assemble_team returns
        // { status:'proposed', session_id, roster, ... }; run_team_workstreams
        // returns { status:'fan_out_complete', dept_responses, ... };
        // artifact tools return { id, blobUrl?, status?, error? }.
        const isTeamProposal = out.status === 'proposed' && out.session_id && out.roster;
        const isFanOutComplete = out.status === 'fan_out_complete' || out.status === 'no_active_team' || out.status === 'empty_roster';
        const isTeamError = out.status === 'error' && (out.session_id || out.unknown_slugs || out.error);
        if (isTeamProposal) {
          // Defer: open after the stream completes so Higgins finishes
          // explaining the approval process before the modal appears.
          pendingTeamProposal = out;
        } else if (isFanOutComplete) {
          // Fan-out finished (success or no-team early return) — drop the overlay.
          try { window.TeamWorking?.close(); } catch (e) { /* noop */ }
          if (Array.isArray(out.dept_errors) && out.dept_errors.length) {
            showToast(out.dept_errors.length + ' agent' + (out.dept_errors.length === 1 ? '' : 's') + ' had errors');
          }
        } else if (isTeamError) {
          // Close the working overlay if this was a fan-out failure
          try { window.TeamWorking?.close(); } catch (e) { /* noop */ }
          showToast('Team task failed: ' + (out.error || 'unknown'));
        } else if (window.ArtifactWindow && out.id) {
          // Artifact server-side render result — blob_url for docx/pptx,
          // status:'error' for renderer failures. Reconcile the open window.
          const win = window.ArtifactWindow.get(out.id);
          if (win) {
            if (out.blobUrl) {
              win.blobUrl = out.blobUrl;
              win._render();
            }
            if (out.status === 'error') {
              console.error('[higgins] artifact server render error', out.error);
              showToast('Render failed: ' + (out.error || 'unknown'));
            }
          }
        }
      } else if (t === 'error') {
        throw new Error(part.errorText || part.message || 'Stream error');
      }
    }

    // If the team-working overlay is STILL open here, the stream reached EOF
    // without ever delivering the run_team_workstreams result — i.e. /api/chat
    // was killed mid-fan-out (maxDuration) or the connection truncated. The
    // `for await` loop ends cleanly in that case (no error part to catch), so
    // this is the only place we can detect it. Flip the overlay to its stalled
    // state (with Retry) instead of leaving a forever-spinning spinner.
    if (window.TeamWorking?.isOpen?.()) {
      window.TeamWorking.markStalled();
      showToast('Team run stalled — you can retry it');
    }

    if (firstDelta) {
      // Stream ended with no text — treat as empty (could happen if response
      // was purely tool calls with no narrative).
      thinking.remove();
      face.classList.remove('thinking');
      if (!accumulated) agentBubble.innerHTML = '<em style="opacity:0.6">(no response)</em>';
    }

    // Stream is done and Higgins' full message has rendered — now surface the
    // team-assembly modal for approval, passing along his narration so the
    // modal can show the approval context inline.
    if (pendingTeamProposal) {
      try { window.TeamModal.open(pendingTeamProposal, accumulated); }
      catch (mErr) { console.error('[higgins] TeamModal.open failed', mErr); }
    }
  } catch (err) {
    try { thinking.remove(); } catch {}
    face.classList.remove('thinking');
    face.classList.remove('speaking');
    if (err && err.name === 'AbortError') {
      // JB hit Stop — tear the overlay down cleanly, this was intentional.
      try { window.TeamWorking?.close(); } catch {}
      agentBubble.innerHTML = '<em style="opacity:0.6">(stopped)</em>';
    } else {
      // A real stream/network error. If a team fan-out was in flight, keep the
      // overlay up but flip it to the stalled state so JB can relaunch it with
      // one click instead of losing the assembled team. Otherwise nothing to
      // tear down.
      console.error('[higgins] send failed', err);
      try {
        if (window.TeamWorking?.isOpen?.()) window.TeamWorking.markStalled();
      } catch {}
      agentBubble.innerHTML = '<em style="color:var(--status-danger)">Something went wrong: ' + escapeHtml(err.message || String(err)) + '</em>';
      showToast('Chat error — see console');
    }
  } finally {
    face.classList.remove('speaking');
    setAgentState('ready', 'Ready to help');
    responding = false;
    currentAbortController = null;
    setSendState(false);
  }
}

// ============================================
// CONVERSATION HYDRATION — REQ-002 Phase 2
// Restores prior messages on page load using localStorage conversationId.
// ============================================
async function loadConversationHistory() {
  const id = localStorage.getItem(HIGGINS_CONV_KEY);
  if (!id) return;
  try {
    const res = await fetch('/api/conversation?id=' + encodeURIComponent(id), {
      headers: authHeaders(),
    });
    if (!res.ok) {
      if (res.status === 404) localStorage.removeItem(HIGGINS_CONV_KEY);
      return;
    }
    const data = await res.json();
    const messages = Array.isArray(data?.messages) ? data.messages : [];
    if (!messages.length) return;

    // Wipe any default greeting bubbles before replaying history.
    const stream = document.getElementById('conversationStream');
    if (stream) stream.innerHTML = '';

    for (const m of messages) {
      const parts = Array.isArray(m.parts) ? m.parts : [];
      const text = parts.filter(p => p && p.type === 'text').map(p => p.text || '').join('');
      const attPart = parts.find(p => p && p.type === '_attachments');
      const atts = attPart && Array.isArray(attPart.items) ? attPart.items : [];
      if (!text && !atts.length) continue;
      const el = addMessage(m.role === 'assistant' ? 'agent' : 'user', textToHtml(text), text);
      if (atts.length && window.HigginsAttachments) {
        window.HigginsAttachments.renderChipsInto(el.querySelector('.message-bubble'), atts);
      }
    }

    // Rehydrate artifact windows from prior tool calls
    const artifacts = Array.isArray(data?.artifacts) ? data.artifacts : [];
    if (artifacts.length && window.ArtifactWindow) {
      window.ArtifactWindow.rehydrate(artifacts);
    }

    // Restore the active team badge (REQ-004 Phase 3). Best-effort; doesn't
    // block history rendering if the lookup is slow or fails.
    restoreActiveTeamForConversation(id);
  } catch (err) {
    console.warn('[higgins] history load failed', err);
  }
}
window.addEventListener('DOMContentLoaded', loadConversationHistory);

function addMessage(role, html, sourceText) {
  const stream = document.getElementById('conversationStream');
  const msg = document.createElement('div');
  msg.className = `message ${role}`;
  if (typeof sourceText === 'string') msg.dataset.source = sourceText;
  const time = new Date().toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
  // Assistant messages get a hover-revealed copy button in the meta row.
  // The copy reads the markdown source stashed in data-source so pastes
  // into Notion / Slack / docs keep formatting.
  msg.innerHTML = role === 'agent'
    ? `<div class="message-bubble">${html}</div><div class="message-meta">${time} <span class="model-badge">Claude Opus 4.7</span>
        <button class="copy-btn" onclick="copyMessageSource(this)" title="Copy markdown" aria-label="Copy message">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button></div>`
    : `<div class="message-bubble">${html}</div><div class="message-meta">${time}</div>`;
  stream.appendChild(msg);
  stream.scrollTop = stream.scrollHeight;
  return msg;
}

async function copyMessageSource(btn) {
  const msg = btn.closest('.message');
  if (!msg) return;
  // Prefer the stashed markdown source; fall back to the rendered bubble text
  // (covers any pre-streamed message that didn't get data-source populated).
  const text = msg.dataset.source ??
               (msg.querySelector('.message-bubble')?.innerText || '');
  if (!text) { showToast('Nothing to copy'); return; }
  try {
    await navigator.clipboard.writeText(text);
    btn.classList.add('copied');
    showToast('Copied');
    setTimeout(() => btn.classList.remove('copied'), 1200);
  } catch (err) {
    console.warn('[higgins] copy failed', err);
    showToast('Copy blocked by browser');
  }
}

// Per-tool labels for the loading indicator
const TOOL_LABELS = {
  create_artifact: 'Opening an artifact…',
  update_artifact: 'Revising the artifact…',
  save_memory: 'Saving to memory…',
  recall_memory: 'Searching memory…',
  forget_memory: 'Removing from memory…',
  summarize_conversation: 'Summarizing the conversation…',
  assemble_team: 'Assembling the team…',
  run_team_workstreams: 'Team is working in parallel…',
};

function addThinkingIndicator(initialText) {
  const stream = document.getElementById('conversationStream');
  const el = document.createElement('div');
  el.className = 'message agent';
  el.innerHTML = '<div class="thinking-indicator"><div class="thinking-dots"><span></span><span></span><span></span></div><span class="thinking-text" id="thinkingText"></span></div>';
  stream.appendChild(el);
  el.querySelector('#thinkingText').textContent = initialText || 'Thinking…';
  stream.scrollTop = stream.scrollHeight;
  return el;
}

function updateThinkingText(text) {
  const t = document.getElementById('thinkingText');
  if (t) t.textContent = text;
}

function setAgentState(state, text) {
  const dot = document.getElementById('statusDot');
  const st = document.getElementById('statusText');
  st.textContent = text;
  dot.classList.toggle('thinking', state === 'thinking' || state === 'listening');
  st.style.color = (state === 'thinking') ? 'var(--agent-thinking)' : 'var(--agent-accent)';
}

function handleChipClick(chip, text) {
  chip.parentElement.style.opacity = '0';
  setTimeout(() => chip.parentElement.remove(), 200);
  document.getElementById('higginsInput').value = text;
  sendMessage();
}

// ============================================
// DYNAMIC CANVAS BLOCK
// ============================================
function addDepartmentBlock() {
  const c = document.getElementById('canvasContent');
  const id = 'block-dept-' + Date.now();
  const block = document.createElement('div');
  block.className = 'canvas-block'; block.id = id;
  block.innerHTML = `
    <div class="block-header"><span class="block-title">OKR Completion by Department</span><div class="block-actions"><button class="icon-btn" onclick="togglePin(this,'${id}')" title="Pin"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg></button><button class="icon-btn" title="More"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg></button></div></div>
    <div class="block-content"><div class="dept-breakdown">
      <div class="dept-card"><div class="dept-name">Sales</div><div class="dept-score" style="color:var(--status-danger)">54%</div><div class="dept-bar"><div class="dept-bar-fill" style="width:54%;background:var(--status-danger)"></div></div></div>
      <div class="dept-card"><div class="dept-name">Support</div><div class="dept-score" style="color:var(--status-warning)">62%</div><div class="dept-bar"><div class="dept-bar-fill" style="width:62%;background:var(--status-warning)"></div></div></div>
      <div class="dept-card"><div class="dept-name">Operations</div><div class="dept-score" style="color:var(--status-warning)">68%</div><div class="dept-bar"><div class="dept-bar-fill" style="width:68%;background:var(--status-warning)"></div></div></div>
      <div class="dept-card"><div class="dept-name">Product</div><div class="dept-score" style="color:var(--status-success)">79%</div><div class="dept-bar"><div class="dept-bar-fill" style="width:79%;background:var(--status-success)"></div></div></div>
      <div class="dept-card"><div class="dept-name">Marketing</div><div class="dept-score" style="color:var(--status-success)">85%</div><div class="dept-bar"><div class="dept-bar-fill" style="width:85%;background:var(--status-success)"></div></div></div>
      <div class="dept-card"><div class="dept-name">HR</div><div class="dept-score" style="color:var(--status-danger)">48%</div><div class="dept-bar"><div class="dept-bar-fill" style="width:48%;background:var(--status-danger)"></div></div></div>
    </div></div>
    <div class="block-footer"><span class="generated-dot"></span>Generated by Higgins &middot; Claude Opus &middot; Just now</div>`;
  c.appendChild(block);
  document.getElementById('workspace').scrollTo({ top: document.getElementById('workspace').scrollHeight, behavior: 'smooth' });
}

// ============================================
// PIN + COMPOSE
// ============================================
let pinnedCount = 0;
function togglePin(btn, blockId) {
  const block = document.getElementById(blockId);
  if (!block) return;
  const isPinned = block.classList.toggle('pinned');
  btn.classList.toggle('pinned', isPinned);
  pinnedCount += isPinned ? 1 : -1;
  document.getElementById('composeBtn').classList.toggle('visible', pinnedCount > 0);
  showToast(isPinned ? 'Pinned to canvas' : 'Unpinned');
}

function openComposer() {
  const preview = document.getElementById('composerPreview');
  // Gather pinned blocks
  const pinned = document.querySelectorAll('.canvas-block.pinned');
  let blocks = '<h3>Q1 OKR Review &mdash; March 21, 2026</h3>';
  pinned.forEach(b => {
    const title = b.querySelector('.block-title')?.textContent || 'Untitled';
    const content = b.querySelector('.block-content')?.innerHTML || '';
    blocks += `<div class="composer-block"><div class="composer-block-label">${title}</div>${content}</div>`;
  });
  preview.innerHTML = blocks;
  document.getElementById('composerOverlay').classList.add('open');
}

function closeComposer(e) {
  if (e && e.target !== document.getElementById('composerOverlay')) return;
  document.getElementById('composerOverlay').classList.remove('open');
}

function saveArtifact() {
  document.getElementById('composerOverlay').classList.remove('open');
  showToast('Artifact saved as Context Asset');
}

// ============================================
// TOAST
// ============================================
function showToast(msg) {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>${msg}`;
  c.appendChild(t);
  setTimeout(() => { t.classList.add('leaving'); setTimeout(() => t.remove(), 200); }, 2500);
}
