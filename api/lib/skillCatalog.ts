/**
 * Skill catalog loader for Higgins 2.0 — REQ-004 Phase 1.
 *
 * The DB mirrors `.agents/skills/` (see docs/skills-sync.md). This module
 * reads two things from `skill_registry`:
 *   1. Higgins's base persona — the full SKILL.md body of `exec-orchestrator`.
 *   2. The tiered catalog of his direct reports + cross-functional helpers
 *      + exec team, used to build the directory injected into the system
 *      prompt (Appendix B of REQ-004).
 *
 * Both values are cached in-memory for 5 minutes per REQ-004 §5 #2 — the
 * filesystem→DB sync is manual today, so the DB rarely changes within a
 * Higgins session.
 *
 * Leaf specialists are intentionally NOT included here — REQ-004 §9
 * locks them as context inside their parent dept orchestrator's prompt
 * (loaded later in Phase 4), not in Higgins's top-level prompt.
 */

import { getServiceClient } from './supabaseClient.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

export interface CatalogEntry {
  slug: string;
  displayName: string | null;
  tagline: string | null;
  department: string | null;
  tier: string;
}

export interface SkillCatalog {
  orchestrators: CatalogEntry[];      // Dept-level orchestrators (mkt, fin, hr, ops, pm, sales, sup)
  crossFunctional: CatalogEntry[];    // biz-* helpers
  execTeam: CatalogEntry[];           // Jarvis, Alfred
}

interface CachedCatalog {
  catalog: SkillCatalog;
  fetchedAt: number;
}

interface CachedHigginsBase {
  content: string;
  fetchedAt: number;
}

let catalogCache: CachedCatalog | null = null;
let higginsBaseCache: CachedHigginsBase | null = null;

/** Test seam — wipe both caches. */
export function resetSkillCatalogCacheForTests(): void {
  catalogCache = null;
  higginsBaseCache = null;
}

function isFresh(fetchedAt: number): boolean {
  return Date.now() - fetchedAt < CACHE_TTL_MS;
}

/**
 * Load the three pools that appear directly in Higgins's prompt.
 *
 * We pull only the columns the catalog block needs. Skills with NULL
 * `tier` are excluded — Phase 0 backfill set tier for every row, so a
 * NULL tier means a hand-inserted or unsynced row that shouldn't be
 * advertised to the LLM.
 */
export async function loadCatalog(): Promise<SkillCatalog> {
  if (catalogCache && isFresh(catalogCache.fetchedAt)) {
    return catalogCache.catalog;
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from('skill_registry')
    .select('slug, display_name, tagline, department, tier')
    .in('tier', ['orchestrator', 'cross_functional', 'exec_team'])
    .order('tier')
    .order('slug');

  if (error) {
    // Soft fail: returning an empty catalog is preferable to crashing the
    // chat. The runtime overlay alone still produces a functional Higgins.
    console.error('[skillCatalog] loadCatalog query failed', error);
    return { orchestrators: [], crossFunctional: [], execTeam: [] };
  }

  const catalog: SkillCatalog = {
    orchestrators: [],
    crossFunctional: [],
    execTeam: [],
  };

  for (const row of data ?? []) {
    const entry: CatalogEntry = {
      slug: row.slug,
      displayName: row.display_name,
      tagline: row.tagline,
      department: row.department,
      tier: row.tier,
    };
    if (row.tier === 'orchestrator') catalog.orchestrators.push(entry);
    else if (row.tier === 'cross_functional') catalog.crossFunctional.push(entry);
    else if (row.tier === 'exec_team') catalog.execTeam.push(entry);
  }

  catalogCache = { catalog, fetchedAt: Date.now() };
  return catalog;
}

/**
 * Load the `exec-orchestrator/SKILL.md` body that defines Higgins's persona.
 *
 * Falls back to an empty string on DB error — chat.ts callers compose this
 * with the runtime overlay, which is always present, so an empty base
 * degrades gracefully rather than crashing.
 */
export async function loadHigginsBase(): Promise<string> {
  if (higginsBaseCache && isFresh(higginsBaseCache.fetchedAt)) {
    return higginsBaseCache.content;
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from('skill_registry')
    .select('content')
    .eq('slug', 'exec-orchestrator')
    .maybeSingle();

  if (error || !data?.content) {
    console.error('[skillCatalog] loadHigginsBase missing exec-orchestrator content', error);
    return '';
  }

  const content = stripFrontmatter(data.content);
  higginsBaseCache = { content, fetchedAt: Date.now() };
  return content;
}

/**
 * Strip YAML frontmatter (a leading `---\n…\n---` block) from a SKILL.md
 * body. The frontmatter is metadata for the filesystem (name, description
 * for the skill registry) and isn't useful when the body is injected as
 * an LLM system-prompt section.
 */
export function stripFrontmatter(text: string): string {
  const match = text.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  return match ? text.slice(match[0].length) : text;
}

/**
 * Format the tiered catalog as the Appendix-B directory block. Character
 * names lead — slugs follow in `code` form so the LLM can call them in
 * tool arguments (Phase 2's `assemble_team` takes slugs).
 *
 * Empty pools produce empty sections, not section headers — keeps the
 * prompt clean when (say) the corpus is mid-sync and the catalog query
 * returned partial data.
 */
export function buildCatalogBlock(catalog: SkillCatalog): string {
  const sections: string[] = [];

  if (catalog.orchestrators.length) {
    sections.push(
      '## Your team — Department Orchestrators\n\n' +
      'These are your direct reports. When a task requires multi-disciplinary work, ' +
      'call `assemble_team` with the relevant slugs from this list (Phase 2). Until ' +
      'that tool ships you may name them inline and describe what you would delegate.\n\n' +
      catalog.orchestrators.map(formatLine).join('\n'),
    );
  }

  if (catalog.crossFunctional.length) {
    sections.push(
      '## Cross-functional helpers (available to you and any orchestrator)\n\n' +
      'Pull these into your synthesis or pass to a dept orchestrator brief.\n\n' +
      catalog.crossFunctional.map(formatLine).join('\n'),
    );
  }

  if (catalog.execTeam.length) {
    sections.push(
      '## Your exec team\n\n' +
      catalog.execTeam.map(formatLine).join('\n'),
    );
  }

  return sections.join('\n\n');
}

function formatLine(entry: CatalogEntry): string {
  // The slug already encodes the department prefix (mkt-orchestrator,
  // biz-pricing, …) and the tagline restates the domain — so we leave
  // the explicit department off the line to keep signal density high.
  const character = entry.displayName ?? '(no character yet)';
  const tagline = entry.tagline ? ` · ${entry.tagline}` : '';
  return `- \`${entry.slug}\` — ${character}${tagline}`;
}
