import { tool } from 'ai';
import { z } from 'zod';
import { createTeamSession, type RosterEntry, type TeamRoster } from './higginsRepo.js';
import { loadCatalog, type CatalogEntry, type SkillCatalog } from './skillCatalog.js';

/**
 * Team-assembly tool — REQ-004 Phase 2.
 *
 * Higgins emits `assemble_team` when JB's task warrants more than a
 * single-domain answer (omni-channel campaigns, strategic reviews,
 * cross-functional decisions). The tool persists the proposed roster
 * to `higgins_team_sessions` with `approved_at = NULL`; the UI modal
 * (Phase 3) reads the tool output, JB approves or edits, and a
 * separate approve endpoint flips `approved_at` to NOW().
 *
 * Size guardrails enforced (REQ-004 §12 decision #3):
 *   1–4 dept orchestrators, 0–6 cross-functional, 0–2 exec team.
 * Soft guidance ("aim for 3–5 total") lives in the description so
 * the LLM treats it as a target, not a hard error.
 *
 * Unknown slugs are filtered out (and reported in the tool result)
 * rather than crashing the call — the LLM occasionally hallucinates
 * a slug, and graceful degradation is better than a turn failure.
 */

const slugList = (max: number) =>
  z
    .array(z.string().regex(/^[a-z0-9-]+$/, 'lowercase letters, digits, hyphens'))
    .max(max);

const assembleTeamInput = z.object({
  task_summary: z
    .string()
    .min(8)
    .max(500)
    .describe(
      'One-line summary of the cross-functional task that warrants a team — used as the modal header and stored on the session row.',
    ),
  orchestrators: slugList(4)
    .min(1)
    .describe(
      'Slugs of department orchestrators (mkt-orchestrator, fin-orchestrator, etc.). At least 1, max 4. Pick from the directory in your prompt.',
    ),
  cross_functional: slugList(6)
    .optional()
    .default([])
    .describe(
      'Slugs of cross-functional helpers (biz-pricing, biz-legal, etc.). Max 6. Optional — include only when the task genuinely benefits.',
    ),
  exec_team: slugList(2)
    .optional()
    .default([])
    .describe(
      'Slugs of exec team members (exec-chief-of-staff = Jarvis, exec-strategic-advisor = Alfred). Max 2. Pull in for strategic-narrative or board-prep tasks.',
    ),
  intent: z
    .enum(['auto', 'explicit_phrase', 'explicit_button'])
    .optional()
    .default('auto')
    .describe(
      "How this assembly was triggered. `auto` when you decided unprompted; `explicit_phrase` when JB asked ('bring the team together'); `explicit_button` when the UI button fired it.",
    ),
});

function resolveAgainstPool(
  proposedSlugs: string[],
  pool: CatalogEntry[],
): { resolved: RosterEntry[]; unknown: string[] } {
  const bySlug = new Map(pool.map((e) => [e.slug, e]));
  const resolved: RosterEntry[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const slug of proposedSlugs) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    const hit = bySlug.get(slug);
    if (!hit) {
      unknown.push(slug);
      continue;
    }
    resolved.push({ slug: hit.slug, display_name: hit.displayName });
  }
  return { resolved, unknown };
}

export function makeTeamTools(conversationId: string) {
  return {
    assemble_team: tool({
      description: [
        'Propose an agent team for a multi-disciplinary task. Open the team-assembly modal so JB can review and approve.',
        "Only call when the task requires expertise from 2+ distinct departments OR when JB explicitly asks ('bring the team together').",
        'For single-domain questions, answer directly — do NOT assemble a team for trivial requests.',
        'Pick slugs from the directory in your system prompt. Aim for 3–5 total cards (orchestrators + cross-functional + exec). Hard caps: 1–4 orchestrators, 0–6 cross-functional, 0–2 exec.',
        'Leaf specialists are NOT picked here — the dept orchestrators handle their leaves at fan-out time (Phase 4). You only pick at orchestrator + cross-functional + exec_team level.',
        "After this tool runs the UI shows a modal; JB approves before the fan-out happens. So the tool's return is a *proposal*, not a committed roster.",
      ].join(' '),
      inputSchema: assembleTeamInput,
      execute: async ({
        task_summary,
        orchestrators,
        cross_functional,
        exec_team,
        intent,
      }) => {
        try {
          const catalog: SkillCatalog = await loadCatalog();

          const o = resolveAgainstPool(orchestrators, catalog.orchestrators);
          const c = resolveAgainstPool(cross_functional, catalog.crossFunctional);
          const e = resolveAgainstPool(exec_team, catalog.execTeam);

          // After resolution we may have fewer than the input orchestrators —
          // require at least one survived, otherwise the proposal is empty
          // and the modal would have nothing to show.
          if (o.resolved.length === 0) {
            return {
              status: 'error',
              error:
                'No valid orchestrator slugs after resolution. Check the directory in your prompt and try again.',
              unknown_slugs: o.unknown,
            };
          }

          const roster: TeamRoster = {
            orchestrators: o.resolved,
            cross_functional: c.resolved,
            exec_team: e.resolved,
          };

          const session = await createTeamSession({
            conversationId,
            roster,
            taskSummary: task_summary,
          });

          const unknownSlugs = [...o.unknown, ...c.unknown, ...e.unknown];

          return {
            status: 'proposed',
            session_id: session.id,
            task_summary,
            intent,
            roster,
            counts: {
              orchestrators: roster.orchestrators.length,
              cross_functional: roster.cross_functional.length,
              exec_team: roster.exec_team.length,
              total:
                roster.orchestrators.length +
                roster.cross_functional.length +
                roster.exec_team.length,
            },
            unknown_slugs: unknownSlugs.length ? unknownSlugs : undefined,
          };
        } catch (err) {
          console.error('[higgins/teamTools] assemble_team failed', err);
          return { status: 'error', error: (err as Error).message };
        }
      },
    }),
  };
}
