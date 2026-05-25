// ============================================
// TEAM WORKING OVERLAY — REQ-004 Phase 4
// Shown while run_team_workstreams is in flight so the wait feels alive.
// Read-only: no buttons. Cancel happens via the chat input's Stop button.
// ============================================
const TeamWorking = (() => {
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
  }

  function close() {
    const scrim = document.getElementById('teamWorkingScrim');
    scrim.classList.remove('open');
    scrim.setAttribute('aria-hidden', 'true');
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
    </div>`;
  }

  return { open, close };
})();
window.TeamWorking = TeamWorking;
