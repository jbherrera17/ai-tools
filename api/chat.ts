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
  type RecalledMemory,
} from './lib/higginsRepo.js';
import { requireOwner } from './lib/auth.js';
import { buildHigginsSystemPrompt } from './lib/higginsSystemPrompt.js';
import { makeArtifactTools } from './lib/artifactTools.js';
import { makeMemoryTools } from './lib/memoryTools.js';
import { makeTeamTools } from './lib/teamTools.js';
import { embedText } from './lib/embeddings.js';

/**
 * Higgins 2.0 streaming chat endpoint — REQ-002 Phase 2.
 *
 * Protocol: POST { conversationId?: string, message: string }
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
 * Routes through Vercel AI Gateway via the provider string
 * "anthropic/claude-opus-4-7" (AI_GATEWAY_API_KEY auto-injected on
 * Vercel-linked projects).
 */

export const config = { maxDuration: 180 };

interface ChatBody {
  conversationId?: string;
  message?: string;
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

  // Load prior history (UI message shape) and append the new user turn
  const history = await listMessages(conversationId);
  const uiMessages: UIMessage[] = history.map((m) => ({
    id: m.id,
    role: m.role as UIMessage['role'],
    parts: (m.parts as UIMessage['parts']) ?? [],
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
    msgCount: uiMessages.length,
    memoriesInjected: recalledMemories.length,
    hasGatewayKey: !!process.env.AI_GATEWAY_API_KEY,
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
  });

  const modelMessages = await convertToModelMessages(uiMessages);
  const systemPrompt = await buildHigginsSystemPrompt({ conversationId });

  // REQ-004 Phase 3 — Strict toolChoice forcing.
  //
  // Opus 4.7 occasionally drifts into preamble-chat after team approval
  // ("Building it now…", apology + read-back, no tool call) despite the
  // system prompt's "No preamble" rule. The auto-continuation phrase from
  // the approve flow is a deterministic signal: when that exact pattern
  // arrives AND an active team exists for the conversation, force the
  // model to fire `run_team_workstreams` on this turn. After the tool
  // returns, subsequent steps run unconstrained so synthesis +
  // create_artifact can proceed.
  //
  // Strict heuristic: match only the auto-continuation phrase. JB typing
  // his own continuation falls through to `auto`.
  const AUTO_CONTINUATION_PATTERN = /^Team approved\. Run the workstreams now/;
  let toolChoice: 'auto' | { type: 'tool'; toolName: 'run_team_workstreams' } = 'auto';
  if (AUTO_CONTINUATION_PATTERN.test(incoming)) {
    const activeTeam = await getActiveTeamSession(conversationId).catch((err) => {
      console.warn('[higgins/chat] active team lookup for toolChoice failed', (err as Error).message);
      return null;
    });
    if (activeTeam) {
      toolChoice = { type: 'tool', toolName: 'run_team_workstreams' };
      console.log('[higgins/chat] toolChoice forced to run_team_workstreams', {
        sessionId: activeTeam.id,
      });
    }
  }

  const result = streamText({
    model: 'anthropic/claude-opus-4-7',
    system: systemPrompt + memoryBlock,
    messages: modelMessages,
    tools: {
      ...makeArtifactTools(conversationId),
      ...makeMemoryTools(conversationId),
      ...makeTeamTools(conversationId),
    },
    toolChoice,
    stopWhen: stepCountIs(8),  // bound tool loops
    onFinish: async ({ text }) => {
      console.log('[higgins/chat] onFinish', { textLen: text?.length ?? 0 });
      try {
        await appendMessage({
          conversationId: conversationId!,
          role: 'assistant',
          parts: [{ type: 'text', text }],
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
