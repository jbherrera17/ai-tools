// ============================================
// TEAM WORKING OVERLAY — REQ-004 Phase 4 + Phase 5 aliveness
// Shown while run_team_workstreams is in flight so the wait feels alive.
//
// Aliveness affordances:
//   - Elapsed timer (mm:ss) ticking in the header — primary "not frozen" cue.
//   - Per-card rotating status line ("Analyzing…" → "Drafting…" → …) with
//     staggered indexes so adjacent cards show different statuses at any
//     moment. Cosmetic — the dept calls actually run via Promise.all and
//     don't report intermediate state — but it dispels the "frozen tab"
//     perception during 1–3 min waits.
//
// Stall handling (REQ-004 follow-up — silent-truncation hang):
//   The fan-out runs inside the /api/chat function (maxDuration ceiling). If
//   that function is killed mid-stream, the HTTP stream closes at EOF with no
//   `error` part — so chat.js's `for await` loop just *ends* and no close
//   event ever fires. Pre-fix, the overlay span­ned forever (observed: a
//   182-minute "Synergi Team Working…" spinner over a job that died at the
//   3-minute mark).
//
//   Two independent signals now flip the overlay into a `stalled` state:
//     1. chat.js calls markStalled() when its stream loop ends (or errors)
//        with the overlay still open — the primary, prompt signal.
//     2. A client-side watchdog (STALL_AFTER_MS) — the backstop for the
//        pathological "fetch hangs with no EOF and no error" case (e.g. the
//        laptop slept mid-request).
//
//   Stalled state: freezes the elapsed clock at the stall time, stops the
//   cosmetic status rotation, greys the cards, and surfaces Retry / Dismiss.
//   Retry relaunches the SAME brief against the still-approved team — no
//   re-approval — by handing a kickoff message back to sendMessage().
// ============================================
const TeamWorking = (() => {
  const STATUSES = ['Reading the brief…', 'Analyzing…', 'Drafting…', 'Refining…'];
  const STATUS_TICK_MS = 4500;
  const ELAPSED_TICK_MS = 1000;
  // Backstop watchdog. The /api/chat ceiling is 300s (maxDuration); allow a
  // margin so a legitimately long run isn't falsely flagged. The PRIMARY stall
  // signal is chat.js detecting stream EOF without a fan_out_complete event —
  // this timer only catches the case where the fetch hangs with no EOF and no
  // error at all (so chat.js's loop never advances to detect it).
  const STALL_AFTER_MS = 320_000;

  let startTimeMs = 0;
  let elapsedTimer = null;
  let statusTimer = null;
  let watchdogTimer = null;
  let statusBaseIndex = 0;
  let state = 'idle';        // 'idle' | 'working' | 'stalled'
  let currentBrief = '';     // stashed so Retry can relaunch the same brief
  let retrying = false;      // guards the Retry button against double-fire

  function open(roster, taskBrief) {
    const r = roster || currentActiveTeam;
    if (!r) {
      console.warn('[TeamWorking] open without a roster — skipping overlay');
      return;
    }
    currentBrief = (taskBrief || '').trim();
    state = 'working';
    retrying = false;
    setStalledView(false);
    resetRetryButton();
    document.getElementById('teamWorkingTitle').textContent = 'Synergi Team Working…';
    document.getElementById('teamWorkingTask').textContent =
      currentBrief ? currentBrief : '(no brief — Higgins is working from context)';
    document.getElementById('teamWorkingBody').innerHTML = renderLanes(r);
    const scrim = document.getElementById('teamWorkingScrim');
    scrim.classList.remove('stalled');
    scrim.classList.add('open');
    scrim.setAttribute('aria-hidden', 'false');
    const el = document.getElementById('teamWorkingElapsed');
    if (el) el.classList.remove('stalled');
    startTickers();
  }

  function close() {
    stopTickers();
    state = 'idle';
    retrying = false;
    const scrim = document.getElementById('teamWorkingScrim');
    scrim.classList.remove('open');
    scrim.classList.remove('stalled');
    scrim.setAttribute('aria-hidden', 'true');
    setStalledView(false);
    resetRetryButton();
    document.getElementById('teamWorkingTitle').textContent = 'Synergi Team Working…';
    // Reset display so the next open starts at 0:00 even before the first tick.
    const el = document.getElementById('teamWorkingElapsed');
    if (el) { el.textContent = '0:00'; el.classList.remove('stalled'); }
  }

  // Flip an open overlay into the stalled state. Idempotent, and a no-op when
  // the overlay isn't in the 'working' state (so chat.js's belt-and-suspenders
  // calls can't double-trigger or resurrect a closed overlay).
  function markStalled() {
    if (state !== 'working') return;
    state = 'stalled';
    stopTickers();   // freeze the elapsed clock + stop the cosmetic rotation
    const scrim = document.getElementById('teamWorkingScrim');
    scrim.classList.add('stalled');
    const title = document.getElementById('teamWorkingTitle');
    if (title) title.textContent = 'Team run stalled';
    const el = document.getElementById('teamWorkingElapsed');
    if (el) el.classList.add('stalled');
    // Drop the fake "Drafting…" cues — they'd imply ongoing progress.
    document.querySelectorAll('#teamWorkingBody .tw-card-status').forEach((n) => {
      n.textContent = 'No response';
      n.style.fontStyle = 'normal';
    });
    setStalledView(true);
  }

  // Relaunch the workstreams with the same brief. The team is still approved
  // in Supabase, so the backend re-forces run_team_workstreams on the kickoff
  // message — no re-approval. close() resets the overlay; the new stream's
  // tool-input event reopens it fresh with a 0:00 clock.
  function retry() {
    if (retrying) return;
    retrying = true;
    const brief = currentBrief;
    const btn = document.getElementById('teamWorkingRetryBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Restarting…'; }
    close();
    const kickoff = brief
      ? `Run the workstreams now. Brief:\n\n${brief}`
      : 'Run the workstreams now using the task we discussed above.';
    try {
      if (typeof sendMessage === 'function') {
        sendMessage(kickoff);
      } else {
        console.error('[TeamWorking] sendMessage unavailable — cannot retry');
        if (typeof showToast === 'function') showToast('Retry unavailable — reload the page');
      }
    } catch (e) {
      console.error('[TeamWorking] retry failed', e);
      if (typeof showToast === 'function') showToast('Retry failed — see console');
    }
  }

  function dismiss() { close(); }

  function isOpen()    { return state === 'working' || state === 'stalled'; }
  function isStalled() { return state === 'stalled'; }

  function setStalledView(on) {
    const working = document.getElementById('teamWorkingWorking');
    const stalled = document.getElementById('teamWorkingStalled');
    if (working) working.hidden = on;
    if (stalled) stalled.hidden = !on;
  }

  function resetRetryButton() {
    const btn = document.getElementById('teamWorkingRetryBtn');
    if (btn) { btn.disabled = false; btn.textContent = 'Retry team run'; }
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
    // Backstop: if nothing has torn the overlay down by now, flag it stalled.
    watchdogTimer = setTimeout(markStalled, STALL_AFTER_MS);
  }

  function stopTickers() {
    if (elapsedTimer)  { clearInterval(elapsedTimer); elapsedTimer = null; }
    if (statusTimer)   { clearInterval(statusTimer);  statusTimer  = null; }
    if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
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

  return { open, close, markStalled, retry, dismiss, isOpen, isStalled };
})();
window.TeamWorking = TeamWorking;
