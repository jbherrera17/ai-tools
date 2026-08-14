import { embed } from 'ai';
import { getGatewayProviderOptions } from './gatewayByok.js';

/**
 * Embedding helper — REQ-002 Phase 5.
 *
 * Routes through Vercel AI Gateway via the provider string
 * "openai/text-embedding-3-small" (1536-dim, matches the
 * vector(1536) column on higgins_memories).
 *
 * Small + cheap (~$0.00002 / 1K tokens). Used by save/recall paths.
 */

const EMBED_MODEL = 'openai/text-embedding-3-small';
const MAX_INPUT_CHARS = 8000; // ~2K tokens — well under model limit

export async function embedText(text: string): Promise<number[]> {
  const cleaned = (text || '').trim();
  if (!cleaned) throw new Error('embedText: empty input');

  const input = cleaned.length > MAX_INPUT_CHARS ? cleaned.slice(0, MAX_INPUT_CHARS) : cleaned;

  const { embedding } = await embed({
    model: EMBED_MODEL,
    value: input,
    providerOptions: getGatewayProviderOptions(),
  });

  return embedding;
}
