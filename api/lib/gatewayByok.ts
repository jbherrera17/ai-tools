/**
 * Request-scoped Vercel AI Gateway BYOK.
 *
 * When JB's own provider keys are set, pass them as
 * `providerOptions.gateway.byok` so the Gateway bills those accounts
 * instead of a shared `AI_GATEWAY_API_KEY`. Keys that are unset are
 * omitted. If none are set, omit `byok` entirely (Gateway OIDC / shared
 * key still works, including open-source models).
 *
 * Pass the return value into streamText, generateObject, and embed().
 */

export type GatewayByok = Record<string, Array<{ apiKey: string }>>;

export interface GatewayProviderOptions {
  gateway: { byok: GatewayByok };
}

export function getGatewayProviderOptions(): GatewayProviderOptions | undefined {
  const byok: GatewayByok = {};

  if (process.env.ANTHROPIC_API_KEY) {
    byok.anthropic = [{ apiKey: process.env.ANTHROPIC_API_KEY }];
  }
  if (process.env.OPENAI_API_KEY) {
    byok.openai = [{ apiKey: process.env.OPENAI_API_KEY }];
  }
  if (process.env.XAI_API_KEY) {
    byok.xai = [{ apiKey: process.env.XAI_API_KEY }];
  }
  const googleKey =
    process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY;
  if (googleKey) {
    byok.google = [{ apiKey: googleKey }];
  }

  if (Object.keys(byok).length === 0) return undefined;
  return { gateway: { byok } };
}

export function getProviderKeyStatus(): {
  anthropic: boolean;
  openai: boolean;
  xai: boolean;
  google: boolean;
} {
  return {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    xai: !!process.env.XAI_API_KEY,
    google: !!(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY),
  };
}
