import type { VercelRequest, VercelResponse } from '@vercel/node';
import { loadCatalog } from './lib/skillCatalog.js';
import { requireOwner } from './lib/auth.js';

/**
 * Public-facing catalog for the team-assembly modal — REQ-004 Phase 3.
 *
 *   GET /api/skills-catalog
 *
 * Returns the same three tiered pools (orchestrators / cross_functional /
 * exec_team) that Higgins's system prompt sees, in client-friendly shape.
 * Used by the modal's "+ Add" picker so JB can add an agent Higgins didn't
 * propose.
 *
 * Backed by skillCatalog.loadCatalog() so it shares the 5-min in-process
 * cache — identical TTL to the system-prompt injection. Browser cache
 * headers mirror that.
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireOwner(req, res)) return;

  try {
    const catalog = await loadCatalog();
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.status(200).json({
      orchestrators: catalog.orchestrators.map(toClientShape),
      cross_functional: catalog.crossFunctional.map(toClientShape),
      exec_team: catalog.execTeam.map(toClientShape),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

function toClientShape(e: { slug: string; displayName: string | null; tagline: string | null }) {
  return {
    slug: e.slug,
    display_name: e.displayName,
    tagline: e.tagline,
  };
}
