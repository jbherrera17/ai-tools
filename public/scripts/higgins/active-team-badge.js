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
