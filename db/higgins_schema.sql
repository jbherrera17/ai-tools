-- ============================================
-- Higgins 2.0 — Conversations, Artifacts, Memories
-- Per REQ-002: ai-tools/requests/REQ-002-higgins2-chat-artifacts.md
--
-- Additive-only — does not touch skill_* tables (REQ-001/003).
-- Safe to re-run: all DDL guarded by IF NOT EXISTS.
-- Run in Supabase SQL Editor or via psql.
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";  -- pgvector for Phase 5 memory recall

-- updated_at trigger function may already exist from skills_schema; defensive create.
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- ENUMS
-- ============================================
DO $$ BEGIN
  CREATE TYPE higgins_message_role AS ENUM ('user', 'assistant', 'system', 'tool');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE higgins_artifact_type AS ENUM (
    'markdown',
    'code',
    'html',
    'table',
    'docx',
    'pptx',
    'remotion-video'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE higgins_memory_kind AS ENUM (
    'summary',     -- rolling conversation digest (Phase 5 auto-trigger at 70% context)
    'fact',        -- discrete fact JB asked Higgins to remember
    'preference',  -- how JB likes work done (overlaps with global feedback memories)
    'project',     -- ongoing initiative / context
    'reference'    -- pointer to external resource
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE higgins_memory_scope AS ENUM ('global', 'conversation', 'project');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================
-- CONVERSATIONS
-- ============================================
CREATE TABLE IF NOT EXISTS higgins_conversations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         TEXT NOT NULL DEFAULT 'jb',
  title           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_higgins_conv_user_updated
  ON higgins_conversations (user_id, updated_at DESC);

DROP TRIGGER IF EXISTS trg_higgins_conv_updated_at ON higgins_conversations;
CREATE TRIGGER trg_higgins_conv_updated_at
  BEFORE UPDATE ON higgins_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- MESSAGES — AI SDK v6 UIMessage shape stored in `parts` JSONB
-- ============================================
CREATE TABLE IF NOT EXISTS higgins_messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES higgins_conversations(id) ON DELETE CASCADE,
  role            higgins_message_role NOT NULL,
  parts           JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_higgins_msg_conv_created
  ON higgins_messages (conversation_id, created_at);

-- ============================================
-- ARTIFACTS — stable slug per conversation; updates bump current_version
-- ============================================
CREATE TABLE IF NOT EXISTS higgins_artifacts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES higgins_conversations(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL,                  -- model-chosen, stable per conversation
  type            higgins_artifact_type NOT NULL,
  title           TEXT,
  current_version INTEGER NOT NULL DEFAULT 1,
  blob_url        TEXT,                           -- latest server-rendered file (docx/pptx)
  contributing_agents JSONB,                      -- REQ-004 §8: hierarchical attribution {orchestrators:{}, cross_functional:[]}
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_higgins_artifact_conv
  ON higgins_artifacts (conversation_id, updated_at DESC);

DROP TRIGGER IF EXISTS trg_higgins_artifact_updated_at ON higgins_artifacts;
CREATE TRIGGER trg_higgins_artifact_updated_at
  BEFORE UPDATE ON higgins_artifacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- ARTIFACT VERSIONS — append-only history
-- ============================================
CREATE TABLE IF NOT EXISTS higgins_artifact_versions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  artifact_id     UUID NOT NULL REFERENCES higgins_artifacts(id) ON DELETE CASCADE,
  version_no      INTEGER NOT NULL,
  content         JSONB NOT NULL,                 -- inline content (markdown/code/etc.)
  blob_url        TEXT,                           -- if server-rendered this version
  version_note    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_higgins_artifact_versions_artifact
  ON higgins_artifact_versions (artifact_id, version_no DESC);

-- ============================================
-- MEMORIES — dedicated store, NOT relying on LLM context (REQ-002 §10 decision #2)
-- ============================================
CREATE TABLE IF NOT EXISTS higgins_memories (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             TEXT NOT NULL DEFAULT 'jb',
  conversation_id     UUID REFERENCES higgins_conversations(id) ON DELETE SET NULL,
  kind                higgins_memory_kind NOT NULL,
  scope               higgins_memory_scope NOT NULL DEFAULT 'global',
  title               TEXT,
  content             TEXT NOT NULL,              -- distilled prose, retrieval-ready
  source_message_ids  UUID[],                     -- which messages this memory was distilled from
  importance          SMALLINT NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  embedding           vector(1536),               -- Phase 5: populated by recall pipeline
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ                 -- NULL = permanent
);

CREATE INDEX IF NOT EXISTS idx_higgins_mem_user_kind
  ON higgins_memories (user_id, kind);

CREATE INDEX IF NOT EXISTS idx_higgins_mem_conv
  ON higgins_memories (conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_higgins_mem_importance_created
  ON higgins_memories (importance DESC, created_at DESC);

-- HNSW index for semantic recall (cosine distance). Phase 5 will populate `embedding`.
-- Index built once embeddings exist; safe to keep here — empty index is cheap.
CREATE INDEX IF NOT EXISTS idx_higgins_mem_embedding_hnsw
  ON higgins_memories USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ============================================
-- TEAM SESSIONS — REQ-004 §8 (migration 003)
-- One assembled team per conversation; approved_at gates active vs proposed.
-- ============================================
CREATE TABLE IF NOT EXISTS higgins_team_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES higgins_conversations(id) ON DELETE CASCADE,
  roster          JSONB NOT NULL,                  -- {orchestrators:[], cross_functional:[], exec_team:[]}
  task_summary    TEXT,
  assembled_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at     TIMESTAMPTZ                      -- null = proposed; set = approved & active
);

CREATE INDEX IF NOT EXISTS idx_higgins_team_conv
  ON higgins_team_sessions(conversation_id, assembled_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_higgins_team_active_per_conv
  ON higgins_team_sessions(conversation_id)
  WHERE approved_at IS NOT NULL;

-- ============================================
-- ROW LEVEL SECURITY — deny-by-default
--
-- v1 is single-user. All app access uses the service-role key
-- (api/lib/supabaseClient.ts), which BYPASSES RLS. Enabling RLS here
-- with no policies means the anon key has zero access — defense in
-- depth in case browser code or a leaked anon key ever points at
-- these tables. When multi-user lands (v2), add auth.uid()-scoped
-- policies; the tables already being RLS-enabled means no risky
-- "flip the switch on populated tables" migration.
-- ============================================
ALTER TABLE higgins_conversations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE higgins_messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE higgins_artifacts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE higgins_artifact_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE higgins_memories           ENABLE ROW LEVEL SECURITY;
ALTER TABLE higgins_team_sessions      ENABLE ROW LEVEL SECURITY;

-- ============================================
-- MEMORY RECALL FUNCTION — REQ-002 Phase 5
-- pgvector cosine similarity search wrapped in a SQL function so the
-- Supabase JS client can call it via .rpc(). Returns memories ordered
-- by similarity (1 - cosine distance), filterable by kind + scope.
-- ============================================
CREATE OR REPLACE FUNCTION match_higgins_memories(
  query_embedding vector(1536),
  user_filter text DEFAULT 'jb',
  match_count int DEFAULT 5,
  kind_filter higgins_memory_kind DEFAULT NULL,
  scope_filter higgins_memory_scope DEFAULT NULL
)
RETURNS TABLE (
  id          uuid,
  kind        higgins_memory_kind,
  scope       higgins_memory_scope,
  title       text,
  content     text,
  importance  smallint,
  similarity  float,
  created_at  timestamptz
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id, m.kind, m.scope, m.title, m.content, m.importance,
    1 - (m.embedding <=> query_embedding) AS similarity,
    m.created_at
  FROM higgins_memories m
  WHERE m.user_id = user_filter
    AND m.embedding IS NOT NULL
    AND (kind_filter IS NULL OR m.kind = kind_filter)
    AND (scope_filter IS NULL OR m.scope = scope_filter)
    AND (m.expires_at IS NULL OR m.expires_at > now())
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ============================================
-- CONVENIENCE VIEW — recent conversations w/ message + artifact counts
-- ============================================
CREATE OR REPLACE VIEW higgins_conversation_summary AS
SELECT
  c.id,
  c.user_id,
  c.title,
  c.created_at,
  c.updated_at,
  (SELECT COUNT(*) FROM higgins_messages m  WHERE m.conversation_id = c.id) AS message_count,
  (SELECT COUNT(*) FROM higgins_artifacts a WHERE a.conversation_id = c.id) AS artifact_count
FROM higgins_conversations c;
