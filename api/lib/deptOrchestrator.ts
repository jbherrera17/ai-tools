import { generateObject } from 'ai';
import { z } from 'zod';
import {
  getSkillBySlug,
  getLeafSkillsForDept,
  type SkillRow,
} from './higginsRepo.js';
import { stripFrontmatter } from './skillCatalog.js';

/**
 * Department orchestrator runtime — REQ-004 Phase 4.
 *
 * Each approved dept orchestrator is its own LLM call (Option C, locked
 * in REQ-004 §9). The runner:
 *
 *   1. Loads the orchestrator's full SKILL.md body from the DB.
 *   2. Pulls its leaf specialists as a one-line directory (the orchestrator
 *      decides which leaves apply — leaves do NOT get their own LLM call).
 *   3. Composes a tight sub-prompt: persona + leaves + cross-functional
 *      taglines + JB's task brief.
 *   4. Calls generateObject (Opus 4.7) with a zod schema so the response
 *      arrives structured — `body` (Markdown, for Higgins to weave in)
 *      and `consulted` (character names so attribution is exact).
 *
 * No streaming here — the dept call's output isn't shown directly to JB;
 * Higgins synthesizes the user-facing reply. Phase 6 may revisit if a
 * per-dept progress indicator is worth the extra plumbing.
 */

const DEPT_RESPONSE_SCHEMA = z.object({
  body: z
    .string()
    .min(1)
    .describe(
      "Your department's response to the task — recommendations, analysis, options, trade-offs, open questions. Markdown allowed (headers, tables, lists, bold). Be as substantive as the task warrants; Higgins will weave you into the user-facing synthesis, so giving him too little is worse than giving him too much.",
    ),
  consulted: z
    .array(z.string())
    .max(20)
    .describe(
      'Character names of the leaf specialists you drew on for this response (e.g. ["Harper", "Sage"]). Only include leaves whose expertise materially shaped what you wrote — empty array is fine for a quick domain-only answer.',
    ),
});

export type DeptResponse = z.infer<typeof DEPT_RESPONSE_SCHEMA>;

export interface DeptResult extends DeptResponse {
  slug: string;
  character: string | null;
}

export interface RunDeptArgs {
  deptSlug: string;                          // e.g. 'mkt-orchestrator'
  taskBrief: string;                          // JB's request + relevant context
  crossFunctional?: Array<{
    slug: string;
    character: string | null;
    tagline: string | null;
  }>;
  /** Propagated from the outer streamText so a Stop click cancels sub-calls. */
  abortSignal?: AbortSignal;
}

// Sonnet 4.6 for sub-calls (REQ-004 Phase 4 decision 2026-05-22): Opus 4.7
// for 4× parallel structured generation reliably exceeded the gateway's
// reasonable response window. Sonnet is 3–5× faster, still capable for
// departmental synthesis. Higgins (the user-facing synthesizer) stays on
// Opus.
const MODEL = 'anthropic/claude-sonnet-4-6';

// Per-call wall-clock cap. Parallel fan-out means total fan-out wall time
// is max(sub-call latency); 120s accommodates Sonnet producing the full
// substantive responses real strategy work needs (often 6–10K chars) while
// still bounding a stuck gateway response so the whole turn doesn't strand.
const PER_CALL_TIMEOUT_MS = 120_000;

export async function runDeptOrchestrator(args: RunDeptArgs): Promise<DeptResult> {
  const orchestrator = await getSkillBySlug(args.deptSlug);
  if (!orchestrator) {
    throw new Error(`unknown dept orchestrator slug: ${args.deptSlug}`);
  }
  if (!orchestrator.content) {
    throw new Error(`dept orchestrator ${args.deptSlug} has no SKILL.md content in DB — re-sync skills`);
  }

  // The dept prefix encodes the slug pattern for leaves. e.g. mkt-orchestrator → 'mkt'
  const deptKey = orchestrator.department || args.deptSlug.split('-')[0];
  const leaves = await getLeafSkillsForDept(deptKey);

  const basePersona = stripFrontmatter(orchestrator.content);
  const prompt = buildDeptPrompt({
    basePersona,
    leaves,
    crossFunctional: args.crossFunctional ?? [],
    taskBrief: args.taskBrief,
    orchestratorCharacter: orchestrator.display_name,
  });

  // Promise.race against a timeout so a hung gateway response surfaces as
  // a clean per-dept error rather than killing the whole fan-out.
  const generation = generateObject({
    model: MODEL,
    schema: DEPT_RESPONSE_SCHEMA,
    system: prompt.system,
    prompt: prompt.user,
    abortSignal: args.abortSignal,
  });

  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`dept ${args.deptSlug} exceeded ${PER_CALL_TIMEOUT_MS / 1000}s timeout`)),
      PER_CALL_TIMEOUT_MS,
    );
  });

  try {
    const { object } = await Promise.race([generation, timeout]);
    return {
      slug: orchestrator.slug,
      character: orchestrator.display_name,
      body: object.body,
      consulted: object.consulted,
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

interface BuildDeptPromptArgs {
  basePersona: string;
  leaves: SkillRow[];
  crossFunctional: Array<{ slug: string; character: string | null; tagline: string | null }>;
  taskBrief: string;
  orchestratorCharacter: string | null;
}

interface PromptParts {
  system: string;
  user: string;
}

function buildDeptPrompt(args: BuildDeptPromptArgs): PromptParts {
  const leafDirectory = args.leaves.length
    ? args.leaves
        .map((l) => {
          const character = l.display_name ?? '(no character)';
          const tag = l.tagline ? ` · ${l.tagline}` : '';
          return `- \`${l.slug}\` — ${character}${tag}`;
        })
        .join('\n')
    : '_(no leaf specialists registered for this department)_';

  const crossFunctional = args.crossFunctional.length
    ? args.crossFunctional
        .map((c) => {
          const character = c.character ?? '(no character)';
          const tag = c.tagline ? ` · ${c.tagline}` : '';
          return `- \`${c.slug}\` — ${character}${tag}`;
        })
        .join('\n')
    : '';

  // System message = the orchestrator's full persona + the leaf + cross-functional
  // directories + the structured-output instruction. The user message is JB's
  // task brief, framed so the orchestrator knows it's been delegated by Higgins.
  const system = [
    args.basePersona,
    '## Your leaf specialists (you may draw on these without separate calls)',
    leafDirectory,
    crossFunctional
      ? `## Cross-functional helpers available to this task\n\n${crossFunctional}\n\nThese sit outside your department but are on the assembled team — reference them by character name when their expertise shapes a recommendation.`
      : '',
    '## Your response',
    'You are running as one of several department orchestrators delegated to in parallel by Higgins. Higgins will synthesize the team\'s outputs into a single reply to JB. Your job: produce your department\'s recommendation in full, in Markdown, with enough detail that Higgins can quote or summarize. Be direct, structured, and substantive. Open questions explicitly when JB\'s decision is required.',
    'Return a JSON object with `body` (your Markdown response) and `consulted` (character names of leaves you actually drew on — empty array is honest when the task didn\'t need them).',
  ].filter(Boolean).join('\n\n');

  const user = `Higgins has delegated this task to ${args.orchestratorCharacter ?? args.basePersona.match(/Name:\s*(.+)/)?.[1] ?? 'you'}:\n\n${args.taskBrief}\n\nRespond as the department orchestrator. Higgins will weave your output into the final reply to JB.`;

  return { system, user };
}
