import { tool } from 'ai';
import { z } from 'zod';
import {
  createTeamSession,
  getActiveTeamSession,
  type RosterEntry,
  type TeamRoster,
} from './higginsRepo.js';
import { loadCatalog, type CatalogEntry, type SkillCatalog } from './skillCatalog.js';
import { runDeptOrchestrator, type DeptResult } from './deptOrchestrator.js';

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

// ───────────────────────────────────────────────────────────────────────
// run_team_workstreams — REQ-004 Phase 4 hierarchical fan-out
// ───────────────────────────────────────────────────────────────────────

const runTeamWorkstreamsInput = z.object({
  task_brief: z
    .string()
    .min(20)
    .max(12000)
    .describe(
      "A concrete brief for the team: what they're working on, JB's constraints, what good looks like, any decisions JB has already locked. Will be sent to each department orchestrator. Include the relevant context from the conversation — they don't have your chat history. Be substantive; trim only obvious chat banter.",
    ),
});

export function makeTeamTools(conversationId: string) {
  return {
    run_team_workstreams: tool({
      description: [
        'Fan out the active approved team in parallel: each department orchestrator runs as its own LLM call against the same task brief, drawing on its leaf specialists for context.',
        'Call this when the active team has been approved and JB has handed you substantive work the team should execute on (a strategy, a recommendation, a multi-domain decision).',
        'Returns each orchestrator\'s structured response (body + consulted leaf characters). Use the returned bundle to synthesize the user-facing reply — quote characters by name, weave findings, surface trade-offs, end with the open questions JB needs to decide.',
        'Do NOT call this on a turn where there\'s no approved team — assemble first. Do NOT call this for a clarifying question or chat banter — answer inline.',
      ].join(' '),
      inputSchema: runTeamWorkstreamsInput,
      execute: async ({ task_brief }, { abortSignal }) => {
        try {
          const session = await getActiveTeamSession(conversationId);
          if (!session) {
            return {
              status: 'no_active_team',
              message: 'No approved team for this conversation. Assemble a team first.',
            };
          }
          const roster: TeamRoster = session.roster;
          if (!roster.orchestrators || roster.orchestrators.length === 0) {
            return {
              status: 'empty_roster',
              message: 'Active team has no department orchestrators to fan out to.',
            };
          }

          const catalog: SkillCatalog = await loadCatalog();
          const crossFunctional = (roster.cross_functional ?? []).map((c) => {
            const hit = catalog.crossFunctional.find((e) => e.slug === c.slug);
            return {
              slug: c.slug,
              character: c.display_name ?? hit?.displayName ?? null,
              tagline: hit?.tagline ?? null,
            };
          });

          // Parallel fan-out. Wrap individual failures so a single dept's
          // error doesn't abort the whole bundle — Higgins gets a noted gap.
          const results = await Promise.all(
            roster.orchestrators.map(async (o) => {
              try {
                const result = await runDeptOrchestrator({
                  deptSlug: o.slug,
                  taskBrief: task_brief,
                  crossFunctional,
                  abortSignal,
                });
                return { kind: 'ok' as const, result };
              } catch (err) {
                // Never pass the raw err to console.error — AI SDK error
                // objects sometimes have exotic property descriptors that
                // crash Node's util.inspect. Extract scalars first.
                const e = err as { message?: string; name?: string; cause?: { message?: string }; stack?: string };
                const msg = e?.message ?? String(err);
                const name = e?.name ?? 'Error';
                const causeMsg = e?.cause?.message;
                console.error(
                  `[higgins/run_team_workstreams] dept ${o.slug} failed: ${name}: ${msg}` +
                  (causeMsg ? ` (cause: ${causeMsg})` : ''),
                );
                if (e?.stack) console.error(e.stack.split('\n').slice(0, 5).join('\n'));
                return {
                  kind: 'error' as const,
                  slug: o.slug,
                  character: o.display_name ?? null,
                  error: msg,
                };
              }
            }),
          );

          const dept_responses = results
            .filter((r): r is { kind: 'ok'; result: DeptResult } => r.kind === 'ok')
            .map((r) => r.result);
          const dept_errors = results
            .filter((r): r is { kind: 'error'; slug: string; character: string | null; error: string } => r.kind === 'error')
            .map((r) => ({ slug: r.slug, character: r.character, error: r.error }));

          return {
            status: 'fan_out_complete',
            session_id: session.id,
            task_brief,
            dept_responses,
            dept_errors: dept_errors.length ? dept_errors : undefined,
            cross_functional_context: crossFunctional.map((c) => ({
              slug: c.slug,
              character: c.character,
              tagline: c.tagline,
            })),
            exec_team_context: (roster.exec_team ?? []).map((e) => ({
              slug: e.slug,
              character: e.display_name ?? null,
            })),
          };
        } catch (err) {
          const e = err as { message?: string; name?: string; stack?: string };
          const msg = e?.message ?? String(err);
          console.error(`[higgins/run_team_workstreams] fan-out failed: ${e?.name ?? 'Error'}: ${msg}`);
          if (e?.stack) console.error(e.stack.split('\n').slice(0, 5).join('\n'));
          return { status: 'error', error: msg };
        }
      },
    }),

    assemble_team: tool({
      description: [
        'Opens the team-assembly modal in the chat surface so JB can approve a proposed agent roster.',
        "Call this tool — do NOT roleplay or pre-narrate the team — whenever JB uses an explicit team phrase ('bring the team together', 'assemble the team', 'who would you bring in', 'pull the team', 'convene the team') OR whenever the task clearly requires expertise from 2+ distinct departments.",
        'Calling this tool IS the correct action. The tool itself is the visual moment JB is asking for; calling it does not trigger anything downstream that requires extra confirmation.',
        'For single-domain questions where JB did not invoke a team phrase, answer directly without calling this tool.',
        'Pick slugs from the directory in your system prompt. Aim for 3–5 cards total. Hard caps: 1–4 orchestrators, 0–6 cross-functional, 0–2 exec_team.',
        'Pick at orchestrator + cross-functional + exec_team level only. Leaf specialists are not picked here.',
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
