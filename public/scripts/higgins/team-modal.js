// ============================================
// TEAM ASSEMBLY MODAL — REQ-004 Phase 3
// Center-screen modal driven by the `assemble_team` tool's output.
// State (proposal + edits) lives in memory; only the approve flow
// hits the network. Cancel hits DELETE so the proposal row doesn't
// linger as a stale NULL-approved_at record.
// ============================================
const TeamModal = (() => {
  // minCount = orchestrator floor; maxCount mirrors REQ-004 §12 #3 hard caps.
  const LANES = [
    { key: 'orchestrators',    label: 'Department Orchestrators', minCount: 1, maxCount: 4 },
    { key: 'cross_functional', label: 'Cross-functional helpers', minCount: 0, maxCount: 6 },
    { key: 'exec_team',        label: 'Exec team',                minCount: 0, maxCount: 2 },
  ];
  let state = null;       // { sessionId, taskSummary, roster, originalRoster, conversationId, availablePools, pickerOpen }
  let working = false;    // request in flight — block re-entrancy

  // narration: Higgins' full streamed message for this turn (the approval
  // walkthrough). Shown inline so JB never has to read the chat behind the
  // modal to understand what he's approving.
  function open(payload, narration) {
    if (!payload || !payload.session_id || !payload.roster) {
      console.warn('[TeamModal] open called without session_id/roster', payload);
      return;
    }
    state = {
      sessionId: payload.session_id,
      taskSummary: payload.task_summary || '',
      // Deep clone — the modal may mutate the lanes via Remove / Add
      roster: deepCloneRoster(payload.roster),
      originalRoster: deepCloneRoster(payload.roster),
      conversationId: localStorage.getItem(HIGGINS_CONV_KEY) || null,
      availablePools: null,   // populated by the catalog fetch below
      pickerOpen: null,       // which lane's "+ Add" picker is currently expanded (string key or null)
    };
    document.getElementById('teamModalTask').textContent = state.taskSummary || '(no task summary)';
    document.getElementById('teamModalInfo').textContent = 'Review the team and approve to continue.';
    document.getElementById('teamModalApproveBtn').disabled = false;
    // Surface Higgins' approval narration inside the modal (option 3).
    const ctx = document.getElementById('teamModalContext');
    if (ctx) {
      const text = (narration || '').trim();
      if (text) {
        ctx.innerHTML = textToHtml(text);
        ctx.hidden = false;
      } else {
        ctx.innerHTML = '';
        ctx.hidden = true;
      }
    }
    // Fresh clarification field per proposal.
    const clarify = document.getElementById('teamModalClarify');
    if (clarify) clarify.value = '';
    render();
    document.getElementById('teamModalScrim').classList.add('open');
    // Fetch the full catalog so the "+ Add" pickers can show what wasn't
    // proposed. Best-effort: if it fails, the Add buttons stay disabled
    // with a tooltip — Remove + Approve still work.
    loadAvailablePools().then(() => { if (state) render(); });
  }

  async function loadAvailablePools() {
    try {
      const res = await fetch('/api/skills-catalog', { headers: authHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (state) state.availablePools = data;
    } catch (err) {
      console.warn('[TeamModal] catalog fetch failed; Add buttons will be disabled', err);
    }
  }

  function close() {
    document.getElementById('teamModalScrim').classList.remove('open');
    const clarify = document.getElementById('teamModalClarify');
    if (clarify) clarify.value = '';
    const ctx = document.getElementById('teamModalContext');
    if (ctx) { ctx.innerHTML = ''; ctx.hidden = true; }
    state = null;
    working = false;
  }

  function deepCloneRoster(r) {
    return {
      orchestrators:    (r.orchestrators ?? []).map((e) => ({ ...e })),
      cross_functional: (r.cross_functional ?? []).map((e) => ({ ...e })),
      exec_team:        (r.exec_team ?? []).map((e) => ({ ...e })),
    };
  }

  function render() {
    if (!state) return;
    const body = document.getElementById('teamModalBody');
    body.innerHTML = LANES.map((lane) => {
      const entries = state.roster[lane.key] || [];
      const cards = entries.length
        ? `<div class="tm-cards">${entries.map((e) => renderCard(lane.key, e, entries.length, lane.minCount)).join('')}</div>`
        : `<div class="tm-empty-lane">— none —</div>`;
      const count = entries.length ? `<span class="tm-count">${entries.length}</span>` : '';
      const addBtn = renderAddButton(lane);
      const picker = state.pickerOpen === lane.key ? renderPicker(lane) : '';
      return `<div class="tm-section">
        <div class="tm-section-header">
          <div class="tm-section-label">${lane.label}${count}</div>
          ${addBtn}
        </div>
        ${cards}
        ${picker}
      </div>`;
    }).join('');
    // Update approve enable/disable based on min orchestrator rule
    const okay = state.roster.orchestrators.length >= 1;
    document.getElementById('teamModalApproveBtn').disabled = !okay;
  }

  function unselectedForLane(laneKey) {
    if (!state || !state.availablePools) return [];
    const pool = state.availablePools[laneKey] || [];
    const selected = new Set((state.roster[laneKey] || []).map((e) => e.slug));
    return pool.filter((e) => !selected.has(e.slug));
  }

  function renderAddButton(lane) {
    const entries = state.roster[lane.key] || [];
    const atCap = entries.length >= lane.maxCount;
    const remaining = unselectedForLane(lane.key);
    const catalogReady = state.availablePools != null;
    let title, disabled;
    if (!catalogReady) {
      title = 'Loading available agents…';
      disabled = true;
    } else if (atCap) {
      title = 'Maximum ' + lane.maxCount + ' reached for this lane';
      disabled = true;
    } else if (remaining.length === 0) {
      title = 'All available agents already on the team';
      disabled = true;
    } else {
      title = 'Add another (' + remaining.length + ' available)';
      disabled = false;
    }
    const expanded = state.pickerOpen === lane.key;
    return `<button class="tm-section-add-btn ${expanded ? 'open' : ''}" ${disabled ? 'disabled' : ''}
            onclick="TeamModal.togglePicker('${escAttr(lane.key)}')"
            title="${escAttr(title)}" aria-expanded="${expanded ? 'true' : 'false'}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      <span>Add</span>
    </button>`;
  }

  function renderPicker(lane) {
    const remaining = unselectedForLane(lane.key);
    if (remaining.length === 0) {
      return `<div class="tm-picker"><div class="tm-picker-empty">All agents in this lane already on the team.</div></div>`;
    }
    return `<div class="tm-picker">
      ${remaining.map((e) => {
        const character = e.display_name || '(no character)';
        const tagline = e.tagline || '';
        const avatarUrl = '/api/avatar?slug=' + encodeURIComponent(e.slug) + '&size=40';
        return `<button class="tm-picker-item" onclick="TeamModal.addAgent('${escAttr(lane.key)}', '${escAttr(e.slug)}')" title="Add ${escAttr(character)} to the team">
          <img src="${avatarUrl}" alt="" />
          <div class="tm-picker-item-text">
            <div class="tm-picker-item-character">${escapeHtml(character)}</div>
            <div class="tm-picker-item-slug">${escapeHtml(e.slug)}</div>
            ${tagline ? `<div class="tm-picker-item-tagline">${escapeHtml(tagline)}</div>` : ''}
          </div>
        </button>`;
      }).join('')}
    </div>`;
  }

  function togglePicker(laneKey) {
    if (!state) return;
    state.pickerOpen = (state.pickerOpen === laneKey) ? null : laneKey;
    render();
  }

  function addAgent(laneKey, slug) {
    if (!state || working) return;
    const lane = LANES.find((l) => l.key === laneKey);
    if (!lane) return;
    const current = state.roster[laneKey] || [];
    if (current.length >= lane.maxCount) return;
    if (current.some((e) => e.slug === slug)) return;
    const pool = (state.availablePools && state.availablePools[laneKey]) || [];
    const entry = pool.find((e) => e.slug === slug);
    if (!entry) return;
    current.push({
      slug: entry.slug,
      display_name: entry.display_name ?? null,
      tagline: entry.tagline ?? null,
    });
    state.roster[laneKey] = current;
    // Close the picker once a choice is made so the user gets feedback that
    // the agent landed; they can re-open if they want another.
    state.pickerOpen = null;
    render();
  }

  function renderCard(laneKey, entry, laneSize, laneMin) {
    const removable = laneSize > laneMin;
    const avatarUrl = '/api/avatar?slug=' + encodeURIComponent(entry.slug) + '&size=80';
    const character = entry.display_name || '(no character)';
    const tagline = entry.tagline || '';  // not always present in tool output; safe-default empty
    return `<div class="tm-card" data-slug="${escAttr(entry.slug)}" data-lane="${escAttr(laneKey)}">
      <button class="tm-card-remove" ${removable ? '' : 'disabled'}
              onclick="TeamModal.removeAgent('${escAttr(laneKey)}', '${escAttr(entry.slug)}')"
              title="Remove ${escAttr(character)} from the team" aria-label="Remove ${escAttr(character)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <img src="${avatarUrl}" alt="${escAttr(character)} avatar" />
      <div class="tm-card-character">${escapeHtml(character)}</div>
      <div class="tm-card-slug">${escapeHtml(entry.slug)}</div>
      ${tagline ? `<div class="tm-card-tagline">${escapeHtml(tagline)}</div>` : ''}
    </div>`;
  }

  function escAttr(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function removeAgent(laneKey, slug) {
    if (!state || working) return;
    const lane = state.roster[laneKey];
    if (!Array.isArray(lane)) return;
    const idx = lane.findIndex((e) => e.slug === slug);
    if (idx === -1) return;
    // Guard the orchestrator floor (1) defensively even though renderCard
    // hides the button — keyboard activation could still reach this path.
    const laneMin = LANES.find((l) => l.key === laneKey)?.minCount ?? 0;
    if (lane.length <= laneMin) return;
    lane.splice(idx, 1);
    render();
  }

  function rosterChanged() {
    if (!state) return false;
    return JSON.stringify(state.roster) !== JSON.stringify(state.originalRoster);
  }

  async function approve() {
    if (!state || working) return;
    working = true;
    document.getElementById('teamModalApproveBtn').disabled = true;
    document.getElementById('teamModalCancelBtn').disabled = true;
    document.getElementById('teamModalInfo').textContent = 'Saving…';
    try {
      // PATCH first if the user edited the roster, then POST approve.
      if (rosterChanged()) {
        const patchRes = await fetch('/api/team-sessions', {
          method: 'PATCH',
          headers: authHeaders(),
          body: JSON.stringify({ id: state.sessionId, roster: state.roster }),
        });
        if (!patchRes.ok) throw new Error('PATCH ' + patchRes.status);
      }
      const res = await fetch('/api/team-sessions', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ id: state.sessionId, action: 'approve' }),
      });
      if (!res.ok) throw new Error('approve HTTP ' + res.status);
      showActiveTeamBadge(state.roster);
      showToast('Team approved');
      const taskSummary = state.taskSummary;
      // Read the clarification before close() clears the field.
      const clarify = (document.getElementById('teamModalClarify')?.value || '').trim();
      close();
      // Auto-continue: signal Higgins to proceed AND include the task brief
      // so he has zero ambiguity about what to send to the team. Without
      // the explicit brief, the model tends to narrate ("On it, sending
      // the brief now") and end the turn without firing the tool.
      let continuationText = taskSummary && taskSummary.trim()
        ? `Team approved. Run the workstreams now. Brief:\n\n${taskSummary.trim()}`
        : 'Team approved. Run the workstreams now using the task we discussed above.';
      // Fold in any clarifying instructions JB added in the modal.
      if (clarify) {
        continuationText += `\n\nAdditional instructions from JB:\n${clarify}`;
      }
      try { sendMessage(continuationText); }
      catch (e) { console.warn('[TeamModal] auto-continue failed', e); }
    } catch (err) {
      console.error('[TeamModal] approve failed', err);
      const msg = (err && err.message) ? err.message : 'unknown error';
      document.getElementById('teamModalInfo').textContent = 'Approve failed: ' + msg;
      document.getElementById('teamModalApproveBtn').disabled = false;
      document.getElementById('teamModalCancelBtn').disabled = false;
      showToast('Approve failed — see modal footer');
      working = false;
    }
  }

  async function cancel() {
    if (!state || working) { close(); return; }
    working = true;
    document.getElementById('teamModalCancelBtn').disabled = true;
    try {
      const res = await fetch('/api/team-sessions?id=' + encodeURIComponent(state.sessionId), {
        method: 'DELETE',
        headers: authHeaders(),
      });
      // 404 means it was already gone — treat as success
      if (!res.ok && res.status !== 404) {
        console.warn('[TeamModal] cancel returned HTTP ' + res.status);
      }
      showToast('Team dismissed');
    } catch (err) {
      console.warn('[TeamModal] cancel network error', err);
    }
    close();
  }

  function handleScrimClick(e) {
    // Click on the backdrop (not the modal itself) cancels. Block during in-flight requests.
    if (e && e.target && e.target.id === 'teamModalScrim' && !working) {
      cancel();
    }
  }

  function isWorking() { return working; }

  return { open, close, approve, cancel, removeAgent, addAgent, togglePicker, handleScrimClick, isWorking };
})();
window.TeamModal = TeamModal;
