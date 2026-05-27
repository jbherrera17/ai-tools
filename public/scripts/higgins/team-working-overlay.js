// ============================================
// TEAM WORKING OVERLAY — REQ-004 Phase 4 + Phase 5 aliveness
// Shown while run_team_workstreams is in flight so the wait feels alive.
// Read-only: no buttons. Cancel happens via the chat input's Stop button.
//
// Aliveness affordances:
//   - Elapsed timer (mm:ss) ticking in the header — primary "not frozen" cue.
//   - Per-card rotating status line ("Analyzing…" → "Drafting…" → …) with
//     staggered indexes so adjacent cards show different statuses at any
//     moment. Cosmetic — the dept calls actually run via Promise.all and
//     don't report intermediate state — but it dispels the "frozen tab"
//     perception during 1–3 min waits.
// ============================================
const TeamWorking = (() => {
  const STATUSES = ['Reading the brief…', 'Analyzing…', 'Drafting…', 'Refining…'];
  const STATUS_TICK_MS = 4500;
  const ELAPSED_TICK_MS = 1000;

  let startTimeMs = 0;
  let elapsedTimer = null;
  let statusTimer = null;
  let statusBaseIndex = 0;

  function open(roster, taskBrief) {
    const r = roster || currentActiveTeam;
    if (!r) {
      console.warn('[TeamWorking] open without a roster — skipping overlay');
      return;
    }
    document.getElementById('teamWorkingTask').textContent =
      taskBrief && taskBrief.trim() ? taskBrief.trim() : '(no brief — Higgins is working from context)';
    document.getElementById('teamWorkingBody').innerHTML = renderLanes(r);
    const scrim = document.getElementById('teamWorkingScrim');
    scrim.classList.add('open');
    scrim.setAttribute('aria-hidden', 'false');
    startTickers();
  }

  function close() {
    stopTickers();
    const scrim = document.getElementById('teamWorkingScrim');
    scrim.classList.remove('open');
    scrim.setAttribute('aria-hidden', 'true');
    // Reset display so the next open starts at 0:00 even before the first tick.
    const el = document.getElementById('teamWorkingElapsed');
    if (el) el.textContent = '0:00';
  }

  function startTickers() {
    stopTickers();
    startTimeMs = Date.now();
    statusBaseIndex = 0;
    tickElapsed();
    tickStatuses(); // Set initial per-card statuses immediately on open.
    elapsedTimer = setInterval(tickElapsed, ELAPSED_TICK_MS);
    statusTimer = setInterval(() => {
      statusBaseIndex = (statusBaseIndex + 1) % STATUSES.length;
      tickStatuses();
    }, STATUS_TICK_MS);
  }

  function stopTickers() {
    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
    if (statusTimer)  { clearInterval(statusTimer);  statusTimer  = null; }
  }

  function tickElapsed() {
    const el = document.getElementById('teamWorkingElapsed');
    if (!el) return;
    const sec = Math.floor((Date.now() - startTimeMs) / 1000);
    const mm = Math.floor(sec / 60);
    const ss = String(sec % 60).padStart(2, '0');
    el.textContent = mm + ':' + ss;
  }

  function tickStatuses() {
    const nodes = document.querySelectorAll('#teamWorkingBody .tw-card-status');
    nodes.forEach((node, i) => {
      const status = STATUSES[(statusBaseIndex + i) % STATUSES.length];
      if (node.textContent === status) return; // no-op if unchanged
      node.textContent = status;
      // Re-trigger the fade-in animation by removing + forcing reflow + re-adding.
      node.style.animation = 'none';
      void node.offsetWidth;
      node.style.animation = '';
    });
  }

  function renderLanes(roster) {
    const sections = [
      { key: 'orchestrators',    label: 'Department Orchestrators' },
      { key: 'cross_functional', label: 'Cross-functional helpers' },
      { key: 'exec_team',        label: 'Exec team' },
    ];
    const out = [];
    for (const s of sections) {
      const entries = roster[s.key] || [];
      if (!entries.length) continue;
      out.push(`<div class="tw-section">
        <div class="tw-section-label">${s.label}</div>
        <div class="tw-cards">
          ${entries.map(renderCard).join('')}
        </div>
      </div>`);
    }
    return out.join('');
  }

  function renderCard(entry) {
    const slug = String(entry.slug || '');
    const character = entry.display_name || slug;
    const avatarUrl = '/api/avatar?slug=' + encodeURIComponent(slug) + '&size=64';
    return `<div class="tw-card">
      <img src="${avatarUrl}" alt="${escapeHtml(character)} avatar" />
      <div class="tw-card-character">${escapeHtml(character)}</div>
      <div class="tw-card-slug">${escapeHtml(slug)}</div>
      <div class="tw-card-status">${escapeHtml(STATUSES[0])}</div>
    </div>`;
  }

  return { open, close };
})();
window.TeamWorking = TeamWorking;
