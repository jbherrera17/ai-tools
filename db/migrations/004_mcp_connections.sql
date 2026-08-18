-- ============================================
-- MCP CONNECTIONS — connector selectors + custom connector URLs
-- --------------------------------------------
-- Backs the "MCP Connections" module in the Higgins 2.0 Navigate palette.
-- One row per connector (single-owner v1). `custom` connectors carry a
-- server URL that the chat backend uses to load live MCP tools; standard
-- connectors are awareness-only (surfaced in Higgins's system prompt).
-- ============================================
CREATE TABLE IF NOT EXISTS higgins_mcp_connections (
  connector_id  TEXT PRIMARY KEY,               -- stable slug, e.g. 'composio'
  user_id       TEXT NOT NULL DEFAULT 'jb',
  name          TEXT NOT NULL,                   -- display name, e.g. 'Composio'
  custom        BOOLEAN NOT NULL DEFAULT false,  -- true → URL-configurable remote MCP server
  enabled       BOOLEAN NOT NULL DEFAULT false,
  url           TEXT,                            -- server URL for custom connectors
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_higgins_mcp_conn_user_enabled
  ON higgins_mcp_connections (user_id, enabled);
