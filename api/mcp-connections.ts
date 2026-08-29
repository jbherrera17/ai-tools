import type { VercelRequest, VercelResponse } from '@vercel/node';
import { listMcpConnections, upsertMcpConnections } from './lib/higginsRepo.js';
import { requireOwner } from './lib/auth.js';

/**
 * Higgins 2.0 MCP connections store.
 *
 *   GET /api/mcp-connections            → { connections: [...] }
 *   PUT /api/mcp-connections            → { connections: [...] }  (upsert)
 *
 * Backs the "MCP Connections" module in the Navigate palette. The chat
 * endpoint reads the enabled set each turn: custom connectors (with a URL)
 * contribute live MCP tools; standard connectors are surfaced to Higgins
 * as awareness in the system prompt.
 *
 * Node-style handler required by @vercel/node@3. Single-owner (JB) via the
 * shared bearer-token gate.
 */

interface PutBody {
  connections?: Array<{
    connector_id?: unknown;
    name?: unknown;
    custom?: unknown;
    enabled?: unknown;
    url?: unknown;
  }>;
}

// Basic guard: only http(s) URLs are accepted for custom connectors.
function normalizeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const u = new URL(value.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireOwner(req, res)) return;

  if (req.method === 'GET') {
    try {
      const connections = await listMcpConnections();
      res.status(200).json({ connections });
    } catch (err) {
      console.error('[higgins/mcp-connections] list failed', err);
      res.status(500).json({ error: 'Failed to load connections' });
    }
    return;
  }

  if (req.method === 'PUT') {
    let body: PutBody = {};
    if (typeof req.body === 'string') {
      try { body = JSON.parse(req.body) as PutBody; }
      catch { res.status(400).json({ error: 'Invalid JSON body' }); return; }
    } else if (req.body && typeof req.body === 'object') {
      body = req.body as PutBody;
    }

    if (!Array.isArray(body.connections)) {
      res.status(400).json({ error: 'connections array is required' });
      return;
    }

    // Validate + normalize each row. connector_id and name are required.
    const rows: Array<{
      connector_id: string;
      name: string;
      custom: boolean;
      enabled: boolean;
      url: string | null;
    }> = [];
    for (const c of body.connections) {
      const connectorId = typeof c.connector_id === 'string' ? c.connector_id.trim() : '';
      const name = typeof c.name === 'string' ? c.name.trim() : '';
      if (!connectorId || !name) {
        res.status(400).json({ error: 'each connection needs connector_id and name' });
        return;
      }
      if (!/^[a-z0-9-]{1,64}$/.test(connectorId)) {
        res.status(400).json({ error: `invalid connector_id: ${connectorId}` });
        return;
      }
      rows.push({
        connector_id: connectorId,
        name,
        custom: c.custom === true,
        enabled: c.enabled === true,
        url: normalizeUrl(c.url),
      });
    }

    try {
      const connections = await upsertMcpConnections(rows);
      res.status(200).json({ connections });
    } catch (err) {
      console.error('[higgins/mcp-connections] upsert failed', err);
      res.status(500).json({ error: 'Failed to save connections' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
