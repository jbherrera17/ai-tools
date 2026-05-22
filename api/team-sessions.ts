import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getTeamSession,
  getActiveTeamSession,
  approveTeamSession,
  replaceTeamRoster,
  type TeamRoster,
} from './lib/higginsRepo.js';
import { requireOwner } from './lib/auth.js';
import { getServiceClient } from './lib/supabaseClient.js';

/**
 * Team-session endpoint — REQ-004 Phase 3.
 *
 *   GET    /api/team-sessions?id=<uuid>             → fetch a specific session row
 *   GET    /api/team-sessions?conversationId=<uuid> → fetch the active (approved) session for a conversation
 *   POST   /api/team-sessions { id, action: 'approve' }       → stamp approved_at = now()
 *   PATCH  /api/team-sessions { id, roster: {...} }            → replace the roster JSON
 *   DELETE /api/team-sessions?id=<uuid>             → cancel a proposed session (rejects if already approved)
 *
 * The `assemble_team` tool persists the proposal row with `approved_at = NULL`.
 * The modal UI in higgins2.html reads the row via the tool output payload,
 * then calls this endpoint to approve / edit / cancel before fan-out
 * (Phase 4) actually uses the roster.
 */

interface PostBody {
  id?: string;
  action?: 'approve';
}

interface PatchBody {
  id?: string;
  roster?: TeamRoster;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireOwner(req, res)) return;

  // ── GET ───────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const id = singleParam(req.query.id);
    const conversationId = singleParam(req.query.conversationId);

    if (id) {
      const session = await getTeamSession(id);
      if (!session) {
        res.status(404).json({ error: 'session not found' });
        return;
      }
      res.status(200).json({ session });
      return;
    }
    if (conversationId) {
      const session = await getActiveTeamSession(conversationId);
      res.status(200).json({ session });
      return;
    }
    res.status(400).json({ error: 'id or conversationId query parameter required' });
    return;
  }

  // ── POST (approve) ────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = (req.body ?? {}) as PostBody;
    if (!body.id) {
      res.status(400).json({ error: 'id required in body' });
      return;
    }
    if (body.action !== 'approve') {
      res.status(400).json({ error: "only action 'approve' is supported on POST" });
      return;
    }
    const existing = await getTeamSession(body.id);
    if (!existing) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    if (existing.approved_at) {
      res.status(200).json({ session: existing, status: 'already_approved' });
      return;
    }
    const session = await approveTeamSession(body.id);
    res.status(200).json({ session, status: 'approved' });
    return;
  }

  // ── PATCH (edit roster) ───────────────────────────────────────────
  if (req.method === 'PATCH') {
    const body = (req.body ?? {}) as PatchBody;
    if (!body.id || !body.roster) {
      res.status(400).json({ error: 'id and roster required in body' });
      return;
    }
    // Defensive shape check — the modal sends well-formed rosters but
    // a malformed payload at the API surface shouldn't poison the row.
    const roster = normalizeRoster(body.roster);
    if (!roster) {
      res.status(400).json({ error: 'roster must have orchestrators / cross_functional / exec_team arrays of {slug, display_name}' });
      return;
    }
    const session = await replaceTeamRoster(body.id, roster);
    res.status(200).json({ session, status: 'updated' });
    return;
  }

  // ── DELETE (cancel proposal) ──────────────────────────────────────
  if (req.method === 'DELETE') {
    const id = singleParam(req.query.id);
    if (!id) {
      res.status(400).json({ error: 'id query parameter required' });
      return;
    }
    const existing = await getTeamSession(id);
    if (!existing) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    if (existing.approved_at) {
      // Approved sessions are part of the audit trail — refuse to delete.
      // Cancellation only applies to proposals (approved_at IS NULL).
      res.status(409).json({ error: 'cannot cancel an approved session' });
      return;
    }
    const sb = getServiceClient();
    const { error } = await sb.from('higgins_team_sessions').delete().eq('id', id);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ status: 'cancelled', id });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}

function singleParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function normalizeRoster(input: unknown): TeamRoster | null {
  if (!input || typeof input !== 'object') return null;
  const r = input as Record<string, unknown>;
  const lanes: (keyof TeamRoster)[] = ['orchestrators', 'cross_functional', 'exec_team'];
  const out: TeamRoster = { orchestrators: [], cross_functional: [], exec_team: [] };
  for (const lane of lanes) {
    const arr = r[lane];
    if (!Array.isArray(arr)) return null;
    for (const entry of arr) {
      if (!entry || typeof entry !== 'object') return null;
      const e = entry as Record<string, unknown>;
      if (typeof e.slug !== 'string') return null;
      out[lane].push({
        slug: e.slug,
        display_name: typeof e.display_name === 'string' ? e.display_name : null,
      });
    }
  }
  return out;
}
