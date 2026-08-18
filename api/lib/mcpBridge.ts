import { tool, jsonSchema, type Tool, type ToolSet } from 'ai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

/**
 * Live MCP bridge for Higgins 2.0 custom connectors.
 *
 * Custom connectors (Composio, github MCP, Open Brain, …) are remote MCP
 * servers reachable at a configured URL. This module connects to the enabled
 * ones, discovers their tools, and adapts each into an AI SDK `tool()` so the
 * chat endpoint can expose them to Higgins alongside its native tools.
 *
 * Design rules:
 *   - Best-effort and fully non-fatal. A connector that is down, slow, or
 *     unauthenticated is logged and skipped — chat always proceeds.
 *   - Tool names are namespaced (`<connector>__<tool>`) so two connectors
 *     exposing a same-named tool don't collide, and sanitized to the
 *     provider-safe character set.
 *   - Credentials are never stored in the DB. An optional bearer token per
 *     connector is read from env `MCP_<CONNECTOR_ID>_TOKEN` (id upper-cased,
 *     hyphens → underscores) and sent as an Authorization header.
 *   - Callers MUST invoke the returned `close()` (e.g. in streamText.onFinish)
 *     to release the underlying transports.
 */

const CONNECT_TIMEOUT_MS = 8_000;
const LIST_TOOLS_TIMEOUT_MS = 8_000;
const CALL_TOOL_TIMEOUT_MS = 30_000;
const MAX_TOOLS_PER_CONNECTOR = 40;

export interface CustomConnectorInput {
  connector_id: string;
  name: string;
  url: string;
}

export interface McpToolset {
  /** AI SDK tools ready to spread into streamText({ tools }). */
  tools: ToolSet;
  /** Connector ids that connected and contributed ≥1 tool. */
  connected: string[];
  /** Per-connector failures, for logging/telemetry. Never thrown. */
  failures: Array<{ connector_id: string; error: string }>;
  /** Release all live transports. Safe to call once; idempotent. */
  close: () => Promise<void>;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/** Provider-safe, namespaced tool name (≤64 chars, [a-zA-Z0-9_-]). */
function toolKey(connectorId: string, mcpName: string): string {
  const clean = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${clean(connectorId)}__${clean(mcpName)}`.slice(0, 64);
}

function authHeadersFor(connectorId: string): Record<string, string> {
  const envKey = `MCP_${connectorId.toUpperCase().replace(/-/g, '_')}_TOKEN`;
  const token = process.env[envKey];
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Extract a compact, model-friendly value from an MCP tool result. */
function normalizeToolResult(result: unknown): unknown {
  const r = result as {
    isError?: boolean;
    structuredContent?: unknown;
    content?: Array<{ type?: string; text?: string }>;
  };
  if (r && r.structuredContent !== undefined) return r.structuredContent;
  if (r && Array.isArray(r.content)) {
    const text = r.content
      .filter((c) => c?.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n')
      .trim();
    if (text) return r.isError ? { error: text } : text;
  }
  return result;
}

async function connectOne(input: CustomConnectorInput): Promise<{ client: Client; tools: ToolSet }> {
  const url = new URL(input.url);
  const headers = authHeadersFor(input.connector_id);
  const client = new Client(
    { name: 'higgins-2.0', version: '1.0.0' },
    { capabilities: {} },
  );

  // Prefer Streamable HTTP (current MCP transport); fall back to SSE (legacy)
  // when the server rejects the initial POST. Header injection goes through
  // each transport's requestInit / eventSourceInit.
  let connected = false;
  try {
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers },
    });
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `${input.connector_id} connect (http)`);
    connected = true;
  } catch (httpErr) {
    try {
      const sseTransport = new SSEClientTransport(url, {
        requestInit: { headers },
        eventSourceInit: {
          fetch: (u: string | URL, init?: RequestInit) =>
            fetch(u, { ...init, headers: { ...(init?.headers as Record<string, string>), ...headers } }),
        },
      });
      await withTimeout(client.connect(sseTransport), CONNECT_TIMEOUT_MS, `${input.connector_id} connect (sse)`);
      connected = true;
    } catch (sseErr) {
      const hm = (httpErr as Error).message;
      const sm = (sseErr as Error).message;
      throw new Error(`http: ${hm}; sse: ${sm}`);
    }
  }
  if (!connected) throw new Error('not connected');

  const listed = await withTimeout(client.listTools(), LIST_TOOLS_TIMEOUT_MS, `${input.connector_id} listTools`);
  const mcpTools = Array.isArray(listed?.tools) ? listed.tools.slice(0, MAX_TOOLS_PER_CONNECTOR) : [];

  const tools: ToolSet = {};
  for (const mt of mcpTools) {
    if (!mt?.name) continue;
    const key = toolKey(input.connector_id, mt.name);
    const description = [
      `[${input.name}] ${mt.description ?? mt.name}`.trim(),
    ].join(' ');
    const schema = mt.inputSchema && typeof mt.inputSchema === 'object'
      ? mt.inputSchema
      : { type: 'object', properties: {} };

    const adapted: Tool = tool({
      description,
      inputSchema: jsonSchema(schema as Parameters<typeof jsonSchema>[0]),
      execute: async (args: unknown) => {
        const result = await client.callTool(
          { name: mt.name, arguments: (args ?? {}) as Record<string, unknown> },
          undefined,
          { timeout: CALL_TOOL_TIMEOUT_MS },
        );
        return normalizeToolResult(result);
      },
    });
    tools[key] = adapted;
  }

  return { client, tools };
}

/**
 * Connect to every enabled custom connector and return the merged toolset.
 * Never throws — connectors that fail are recorded in `failures`.
 */
export async function loadCustomMcpTools(connectors: CustomConnectorInput[]): Promise<McpToolset> {
  const clients: Client[] = [];
  const tools: ToolSet = {};
  const connected: string[] = [];
  const failures: Array<{ connector_id: string; error: string }> = [];

  const settled = await Promise.allSettled(connectors.map((c) => connectOne(c)));
  settled.forEach((s, i) => {
    const connector = connectors[i];
    if (s.status === 'fulfilled') {
      const count = Object.keys(s.value.tools).length;
      clients.push(s.value.client);
      if (count > 0) {
        Object.assign(tools, s.value.tools);
        connected.push(connector.connector_id);
      } else {
        // Connected but exposed no tools — close it right away.
        s.value.client.close().catch(() => { /* noop */ });
      }
    } else {
      failures.push({
        connector_id: connector.connector_id,
        error: (s.reason as Error)?.message ?? String(s.reason),
      });
    }
  });

  const close = async () => {
    await Promise.allSettled(clients.map((c) => c.close()));
    clients.length = 0;
  };

  return { tools, connected, failures, close };
}
