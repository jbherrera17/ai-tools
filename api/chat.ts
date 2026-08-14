import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai';
import {
  createConversation,
  getConversation,
  listMessages,
  appendMessage,
  recallMemories,
  getActiveTeamSession,
  type Message,
  type RecalledMemory,
} from './lib/higginsRepo.js';
import { requireOwner } from './lib/auth.js';
import { buildHigginsSystemPrompt } from './lib/higginsSystemPrompt.js';
import { makeArtifactTools } from './lib/artifactTools.js';
import { makeMemoryTools } from './lib/memoryTools.js';
import { makeTeamTools } from './lib/teamTools.js';
import { embedText } from './lib/embeddings.js';
import { getGatewayProviderOptions } from './lib/gatewayByok.js';
import { getDefaultHigginsModel, isAllowedModel } from './lib/modelCatalog.js';

/**
 * Higgins 2.0 streaming chat endpoint — REQ-002 Phase 2.
 *
 * Protocol: POST { conversationId?: string, message: string, model?: string }
 * Returns:  AI SDK v6 UI Message Stream piped into the Node ServerResponse.
 *           Header `X-Conversation-Id` exposes the id so the client can
 *           persist it to localStorage for new conversations.
 *
 * Uses the Node-style (req, res) signature required by @vercel/node@3.
 * Web-style (Request, Response) is rejected by this runtime version.
 *
 * Server reconstructs full history from Supabase each turn — client
 * only sends the latest user message. Single source of truth.
 *
 * Routes through Vercel AI Gateway via catalog model IDs
 * (HIGGINS_MODEL / request `model`, fallback anthropic/claude-opus-5).
 * Request-scoped BYOK is attached when provider keys exist.
 */

// 300s = the platform max. A team turn = parallel dept fan-out (each dept
// call capped at 120s in deptOrchestrator) PLUS Opus synthesis of the bundle.
// At the old 180s ceiling a 120s fan-out left almost no room for synthesis on
// a heavy brief, so the function was killed mid-stream — the stream truncated
// at EOF with no error, stranding the client's "Team Working" overlay forever.
// 300s gives synthesis ~180s of headroom. The client also now detects a
// truncated stream and offers a retry, so this is defense-in-depth, not the
// sole guard.
export const config = { maxDuration: 300 };

interface ChatBody {
  conversationId?: string;
  message?: string;
  model?: string;
}

/**
 * Walk history newest-first to find the most recent assistant turn. Returns
 * true when that turn's text matches a promise pattern AND its persisted
 * `_meta` marker shows zero tool calls. Used as the drift-recovery trigger
 * for run_team_workstreams forcing.
 *
 * Messages persisted before the `_meta` marker shipped have no count, which
 * we treat as 0 — safe because the promise-pattern still has to match.
 */
function lastAssistantPromisedNoTool(history: Message[], promisePattern: RegExp): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== 'assistant') continue;
    const parts = Array.isArray(m.parts)
      ? (m.parts as Array<{ type?: string; text?: string; toolCallCount?: number }>)
      : [];
    const meta = parts.find((p) => p?.type === '_meta');
    const toolCount = typeof meta?.toolCallCount === 'number' ? meta.toolCallCount : 0;
    if (toolCount > 0) return false;
    const text = parts.find((p) => p?.type === 'text')?.text ?? '';
    return promisePattern.test(text);
  }
  return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireOwner(req, res)) return;

  // Vercel parses JSON bodies automatically when Content-Type is application/json.
  // Be defensive: if body is a string (manual fetch with bad content-type), reparse.
  let body: ChatBody = {};
  if (typeof req.body === 'string') {
    try { body = JSON.parse(req.body) as ChatBody; }
    catch { res.status(400).json({ error: 'Invalid JSON body' }); return; }
  } else if (req.body && typeof req.body === 'object') {
    body = req.body as ChatBody;
  }

  const incoming = body.message?.trim();
  if (!incoming) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  // Optional client model: must be in the curated catalog. Omitted/empty
  // falls back to HIGGINS_MODEL or anthropic/claude-opus-5.
  let model = getDefaultHigginsModel();
  if (typeof body.model === 'string' && body.model.trim()) {
    const requested = body.model.trim();
    if (!isAllowedModel(requested)) {
      res.status(400).json({ error: 'model is not in the allowlist', model: requested });
      return;
    }
    model = requested;
  }

  // Resolve / create conversation
  let conversationId = body.conversationId;
  if (conversationId) {
    const existing = await getConversation(conversationId);
    if (!existing) conversationId = undefined;
  }
  if (!conversationId) {
    const conv = await createConversation({ title: incoming.slice(0, 60) });
    conversationId = conv.id;
  }

  // Load prior history (UI message shape) and append the new user turn.
  // Strip our `_meta` markers (drift-recovery bookkeeping) so the AI SDK's
  // convertToModelMessages sees only canonical part types.
  const history = await listMessages(conversationId);
  const uiMessages: UIMessage[] = history.map((m) => ({
    id: m.id,
    role: m.role as UIMessage['role'],
    parts: (Array.isArray(m.parts)
      ? (m.parts as Array<{ type?: string }>).filter((p) => p?.type !== '_meta')
      : []) as UIMessage['parts'],
  }));

  const userParts = [{ type: 'text' as const, text: incoming }];
  await appendMessage({
    conversationId,
    role: 'user',
    parts: userParts,
  });
  uiMessages.push({
    id: randomUUID(),
    role: 'user',
    parts: userParts,
  });

  // Recall relevant memories — embed the new user message, top-3 with
  // similarity > 0.4. Soft failures are non-fatal: chat still proceeds
  // without injection if embeddings or pgvector misbehave.
  let recalledMemories: RecalledMemory[] = [];
  try {
    const queryEmbedding = await embedText(incoming);
    const candidates = await recallMemories({ queryEmbedding, matchCount: 3 });
    recalledMemories = candidates.filter((m) => m.similarity >= 0.4);
  } catch (err) {
    console.warn('[higgins/chat] memory recall skipped', (err as Error).message);
  }

  const memoryBlock = recalledMemories.length
    ? '\n\n## Relevant memories (auto-recalled)\n' +
      recalledMemories
        .map(
          (m, i) =>
            `${i + 1}. [${m.kind}] ${m.title ? m.title + ' — ' : ''}${m.content}` +
            ` (id=${m.id}, importance=${m.importance}, similarity=${m.similarity.toFixed(2)})`,
        )
        .join('\n')
    : '';

  console.log('[higgins/chat] streamText starting', {
    conversationId,
    model,
    msgCount: uiMessages.length,
    memoriesInjected: recalledMemories.length,
    hasGatewayKey: !!process.env.AI_GATEWAY_API_KEY,
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
  });

  const modelMessages = await convertToModelMessages(uiMessages);
  const systemPrompt = await buildHigginsSystemPrompt({ conversationId });

  // REQ-004 Phase 3+ — toolChoice forcing for run_team_workstreams.
  //
  // Opus 4.7 silently violates the system prompt's "No preamble" rule and
  // drifts into talk-about-doing-it-without-doing-it ("Building it now…",
  // "Let me get the doc opened"). Two complementary triggers protect against
  // this:
  //
  //   1. APPROVAL_TRIGGER (proactive) — broadened from the original
  //      auto-continuation-only pattern to catch the variants the system
  //      prompt already teaches the model to recognize: "team approved",
  //      "approved, run it", "proceed with…", "kick off", "go ahead", "let's
  //      go", etc. When an active team exists and JB sends one of these,
  //      force the fan-out tool on this turn.
  //
  //   2. PROMISE_PATTERN (reactive drift-recovery) — when the previous
  //      assistant turn made an action-promise AND fired zero tool calls,
  //      the current user message (whatever its phrasing — "I don't see
  //      it", "ok?", anything) re-triggers the tool. This rescues the
  //      common nudge-after-drift case so JB doesn't have to phrase the
  //      magic words.
  //
  // After the tool returns, subsequent steps run unconstrained so synthesis
  // + create_artifact can proceed naturally.
  const APPROVAL_TRIGGER =
    /^\s*(team\s+approved|approved[,!.]?\s+(run|go|kick|proceed)|proceed\s+(with|now)|kick off|run (the|it|workstreams)|go ahead|let['’]?s\s+(go|run|do))/i;
  const PROMISE_PATTERN =
    /^\s*(on it|running\b|opening\b|building\b|let me\b|kicking off|getting\b|drafting\b|acknowledged\b)/i;

  // Forcing applies to step 0 only — via `prepareStep` below — so the model
  // calls the tool once, then runs auto for synthesis + create_artifact.
  // A top-level toolChoice in AI SDK v6 applies to *every* step in the loop,
  // which causes run_team_workstreams to fire on every step until
  // stepCountIs exhausts (observed: 6 back-to-back fan-outs).
  const proactiveTrigger = APPROVAL_TRIGGER.test(incoming);
  const recoveryTrigger = !proactiveTrigger && lastAssistantPromisedNoTool(history, PROMISE_PATTERN);
  let shouldForceFirstStepTool = false;
  if (proactiveTrigger || recoveryTrigger) {
    const activeTeam = await getActiveTeamSession(conversationId).catch((err) => {
      console.warn('[higgins/chat] active team lookup for toolChoice failed', (err as Error).message);
      return null;
    });
    if (activeTeam) {
      shouldForceFirstStepTool = true;
      console.log('[higgins/chat] will force run_team_workstreams on step 0', {
        sessionId: activeTeam.id,
        reason: proactiveTrigger ? 'approval_trigger' : 'drift_recovery',
      });
    }
  }

  const result = streamText({
    model,
    system: systemPrompt + memoryBlock,
    messages: modelMessages,
    tools: {
      ...makeArtifactTools(conversationId),
      ...makeMemoryTools(conversationId),
      ...makeTeamTools(conversationId),
    },
    providerOptions: getGatewayProviderOptions(),
    prepareStep: ({ stepNumber }) => {
      // Force run_team_workstreams only on the first step of the turn.
      // Subsequent steps run unconstrained (default auto) so the model can
      // synthesize the team's output and optionally call create_artifact.
      if (stepNumber === 0 && shouldForceFirstStepTool) {
        return { toolChoice: { type: 'tool', toolName: 'run_team_workstreams' } };
      }
      return {};
    },
    stopWhen: stepCountIs(8),  // bound tool loops
    onFinish: async ({ text, toolCalls }) => {
      const toolCallCount = Array.isArray(toolCalls) ? toolCalls.length : 0;
      console.log('[higgins/chat] onFinish', { textLen: text?.length ?? 0, toolCallCount });
      try {
        // Persist text plus a `_meta` part holding the turn's tool-call
        // count + names. Future turns' drift-recovery check reads the meta
        // to know whether the last assistant turn was preamble-only. The
        // marker is stripped before convertToModelMessages so the AI SDK
        // never sees a non-canonical part type.
        const parts: Array<Record<string, unknown>> = [{ type: 'text', text }];
        if (toolCallCount > 0) {
          parts.push({
            type: '_meta',
            toolCallCount,
            toolNames: toolCalls!.map((tc) => tc.toolName),
          });
        }
        await appendMessage({
          conversationId: conversationId!,
          role: 'assistant',
          parts,
        });
      } catch (err) {
        console.error('[higgins/chat] onFinish persist failed', err);
      }
    },
    onError: ({ error }) => {
      // Never pass the raw `error` to console.error. AI SDK error objects
      // sometimes carry exotic property descriptors that crash Node's
      // util.inspect — and Node crashing here takes down the dev process,
      // not just the request. Extract scalars.
      const e = error as { name?: string; message?: string; cause?: { message?: string } };
      const name = e?.name ?? 'Error';
      const msg = e?.message ?? String(error);
      const causeMsg = e?.cause?.message;
      console.error(
        `[higgins/chat] stream error: ${name}: ${msg}` +
        (causeMsg ? ` (cause: ${causeMsg})` : ''),
      );
    },
  });

  // Set header before any body write — once writeHead fires, headers are frozen.
  res.setHeader('X-Conversation-Id', conversationId);

  result.pipeUIMessageStreamToResponse(res, {
    onError: (error) => {
      const e = error as { name?: string; message?: string };
      const msg = e?.message ?? String(error);
      console.error(`[higgins/chat] pipeUIMessageStream onError: ${e?.name ?? 'Error'}: ${msg}`);
      return msg;
    },
  });
}
