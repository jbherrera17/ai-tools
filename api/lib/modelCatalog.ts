/**
 * Curated Higgins model catalog — single source of truth.
 * Verified 2026-09-22 against https://ai-gateway.vercel.sh/v1/models.
 * See docs/model-catalog.md for vendor sources and update checks.
 *
 * IDs are Vercel AI Gateway strings (`provider/model`). User-supplied
 * request models MUST be in this list. Env defaults (HIGGINS_MODEL,
 * DEPT_MODEL) should also be catalog IDs; unknown env values fall back.
 */

export interface CatalogModel {
  id: string;
  name: string;
  provider: string;
  group: string;
  description: string;
}

export const FALLBACK_HIGGINS_MODEL = 'anthropic/claude-opus-5';
export const FALLBACK_DEPT_MODEL = 'anthropic/claude-sonnet-5';

const GROUP_ORDER = ['Anthropic', 'OpenAI', 'Grok', 'Gemini', 'DeepSeek', 'Meta', 'Mistral', 'Gemma'] as const;

export const MODEL_CATALOG: CatalogModel[] = [
  {
    id: 'anthropic/claude-opus-5.5',
    name: 'Claude Opus 5.5',
    provider: 'anthropic',
    group: 'Anthropic',
    description: 'Latest Opus — agentic coding and knowledge work',
  },
  {
    id: 'anthropic/claude-fable-5.1',
    name: 'Claude Fable 5.1',
    provider: 'anthropic',
    group: 'Anthropic',
    description: 'Demanding reasoning and long-running agent tasks',
  },
  {
    id: 'anthropic/claude-opus-5',
    name: 'Claude Opus 5',
    provider: 'anthropic',
    group: 'Anthropic',
    description: 'Flagship reasoning — default Higgins synthesizer',
  },
  {
    id: 'anthropic/claude-opus-4.8',
    name: 'Claude Opus 4.8',
    provider: 'anthropic',
    group: 'Anthropic',
    description: 'Previous Opus generation',
  },
  {
    id: 'anthropic/claude-opus-4.7',
    name: 'Claude Opus 4.7',
    provider: 'anthropic',
    group: 'Anthropic',
    description: 'Earlier Opus generation',
  },
  {
    id: 'anthropic/claude-sonnet-5',
    name: 'Claude Sonnet 5',
    provider: 'anthropic',
    group: 'Anthropic',
    description: 'Fast, capable — default department orchestrator',
  },
  {
    id: 'anthropic/claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    group: 'Anthropic',
    description: 'Previous Sonnet generation',
  },
  {
    id: 'anthropic/claude-haiku-4.5',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    group: 'Anthropic',
    description: 'Fastest Claude — light tasks',
  },
  {
    id: 'openai/gpt-6-astra',
    name: 'GPT-6 Astra',
    provider: 'openai',
    group: 'OpenAI',
    description: 'Complex reasoning and coding',
  },
  {
    id: 'openai/gpt-6-sol',
    name: 'GPT-6 Sol',
    provider: 'openai',
    group: 'OpenAI',
    description: 'Balanced intelligence and cost',
  },
  {
    id: 'openai/gpt-6-luna',
    name: 'GPT-6 Luna',
    provider: 'openai',
    group: 'OpenAI',
    description: 'Efficient high-volume tasks',
  },
  {
    id: 'openai/gpt-5.5',
    name: 'GPT-5.5',
    provider: 'openai',
    group: 'OpenAI',
    description: 'Previous GPT flagship',
  },
  {
    id: 'openai/gpt-5.4',
    name: 'GPT-5.4',
    provider: 'openai',
    group: 'OpenAI',
    description: 'Strong general GPT',
  },
  {
    id: 'openai/gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    provider: 'openai',
    group: 'OpenAI',
    description: 'Faster, cheaper GPT',
  },
  {
    id: 'openai/gpt-4.1',
    name: 'GPT-4.1',
    provider: 'openai',
    group: 'OpenAI',
    description: 'Proven GPT-4.1',
  },
  {
    id: 'spacexai/grok-4.7',
    name: 'Grok 4.7',
    provider: 'xai',
    group: 'Grok',
    description: 'Latest Grok — coding and agentic tasks',
  },
  {
    id: 'spacexai/grok-4.6',
    name: 'Grok 4.6',
    provider: 'xai',
    group: 'Grok',
    description: 'Previous Grok generation',
  },
  {
    id: 'spacexai/grok-4.5',
    name: 'Grok 4.5',
    provider: 'xai',
    group: 'Grok',
    description: 'Previous Grok generation',
  },
  {
    id: 'spacexai/grok-4.3',
    name: 'Grok 4.3',
    provider: 'xai',
    group: 'Grok',
    description: 'Earlier Grok 4.x',
  },
  {
    id: 'google/gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    provider: 'google',
    group: 'Gemini',
    description: 'Latest Gemini Flash — reasoning and agents',
  },
  {
    id: 'google/gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash-Lite',
    provider: 'google',
    group: 'Gemini',
    description: 'Efficient lightweight Gemini tasks',
  },
  {
    id: 'google/gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    provider: 'google',
    group: 'Gemini',
    description: 'Previous Gemini Flash generation',
  },
  {
    id: 'google/gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    provider: 'google',
    group: 'Gemini',
    description: 'Fast Gemini Flash',
  },
  {
    id: 'google/gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro Preview',
    provider: 'google',
    group: 'Gemini',
    description: 'Gemini Pro preview',
  },
  {
    id: 'deepseek/deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    provider: 'deepseek',
    group: 'DeepSeek',
    description: 'Latest DeepSeek Flash with vision',
  },
  {
    id: 'deepseek/deepseek-v4-pro-0813',
    name: 'DeepSeek V4 Pro 0813',
    provider: 'deepseek',
    group: 'DeepSeek',
    description: 'Updated DeepSeek V4 Pro checkpoint',
  },
  {
    id: 'deepseek/deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    provider: 'deepseek',
    group: 'DeepSeek',
    description: 'DeepSeek V4 Pro via Gateway',
  },
  {
    id: 'deepseek/deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    provider: 'deepseek',
    group: 'DeepSeek',
    description: 'Fast DeepSeek V4',
  },
  {
    id: 'meta/muse-spark-1.3',
    name: 'Muse Spark 1.3',
    provider: 'meta',
    group: 'Meta',
    description: 'Latest Muse Spark — reasoning and agentic tasks',
  },
  {
    id: 'meta/llama-4-maverick',
    name: 'Llama 4 Maverick',
    provider: 'meta',
    group: 'Meta',
    description: 'Llama 4 Maverick via Gateway',
  },
  {
    id: 'mistral/mistral-medium-3.5',
    name: 'Mistral Medium 3.5',
    provider: 'mistral',
    group: 'Mistral',
    description: 'Multimodal reasoning and coding',
  },
  {
    id: 'mistral/mistral-large-3',
    name: 'Mistral Large 3',
    provider: 'mistral',
    group: 'Mistral',
    description: 'Mistral Large 3 via Gateway',
  },
  {
    id: 'google/gemma-4-31b-it',
    name: 'Gemma 4 31B',
    provider: 'google',
    group: 'Gemma',
    description: 'Gemma 4 31B instruct via Gateway',
  },
];

const ALLOWED = new Set(MODEL_CATALOG.map((m) => m.id));

export function isAllowedModel(id: string): boolean {
  return ALLOWED.has(id);
}

export function getDefaultHigginsModel(): string {
  const env = (process.env.HIGGINS_MODEL || '').trim();
  if (!env) return FALLBACK_HIGGINS_MODEL;
  if (isAllowedModel(env)) return env;
  console.warn('[modelCatalog] HIGGINS_MODEL is not a catalog ID, falling back', env);
  return FALLBACK_HIGGINS_MODEL;
}

export function getDefaultDeptModel(): string {
  const env = (process.env.DEPT_MODEL || '').trim();
  if (!env) return FALLBACK_DEPT_MODEL;
  if (isAllowedModel(env)) return env;
  console.warn('[modelCatalog] DEPT_MODEL is not a catalog ID, falling back', env);
  return FALLBACK_DEPT_MODEL;
}

export function groupedForUi(): Array<{ group: string; models: CatalogModel[] }> {
  const map = new Map<string, CatalogModel[]>();
  for (const m of MODEL_CATALOG) {
    const list = map.get(m.group) ?? [];
    list.push(m);
    map.set(m.group, list);
  }
  return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({
    group: g,
    models: map.get(g)!,
  }));
}
