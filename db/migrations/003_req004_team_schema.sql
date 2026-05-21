-- ============================================
-- Migration 003 — REQ-004 Agent Team Assembly schema deltas
-- Per REQ-004: ai-tools/requests/REQ-004-agent-team-assembly.md
--
-- Additive only — extends skill_registry, adds higgins_team_sessions,
-- and adds higgins_artifacts.contributing_agents. Safe to apply against
-- the live schema (skill_registry has 74 rows, higgins_artifacts active).
--
-- After applying, the canonical schemas in db/skills_schema.sql and
-- db/higgins_schema.sql will be updated to reflect this delta.
-- Run in Supabase SQL Editor or via psql.
-- ============================================

-- ============================================
-- skill_registry extensions
-- department already exists (REQ-001) — not re-added.
-- ============================================
ALTER TABLE skill_registry
  ADD COLUMN IF NOT EXISTS tier         TEXT,         -- 'top' | 'orchestrator' | 'specialist' | 'shared' | 'cross_functional'
  ADD COLUMN IF NOT EXISTS display_name TEXT,         -- character name (Dakota, Marlowe, Harper…); falls back to name
  ADD COLUMN IF NOT EXISTS tagline      TEXT,         -- ≤80 chars for the team-assembly card
  ADD COLUMN IF NOT EXISTS avatar_url   TEXT,         -- Vercel Blob URL; NULL → generated monogram fallback
  ADD COLUMN IF NOT EXISTS content      TEXT,         -- full SKILL.md body — DB mirror for Vercel runtime
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;  -- last sync_skills.py run that observed this slug on disk

CREATE INDEX IF NOT EXISTS idx_skill_registry_tier         ON skill_registry(tier);
CREATE INDEX IF NOT EXISTS idx_skill_registry_last_seen_at ON skill_registry(last_seen_at);

-- ============================================
-- higgins_team_sessions — REQ-004 §8
-- One assembled team per conversation; approved_at gates active vs proposed.
-- ============================================
CREATE TABLE IF NOT EXISTS higgins_team_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES higgins_conversations(id) ON DELETE CASCADE,
  roster          JSONB NOT NULL,                    -- hierarchical: {orchestrators:[], cross_functional:[], exec_team:[]}
  task_summary    TEXT,                              -- e.g. "Omni-channel marketing campaign for Q3"
  assembled_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at     TIMESTAMPTZ                        -- null until JB approves the proposed team
);

CREATE INDEX IF NOT EXISTS idx_higgins_team_conv
  ON higgins_team_sessions(conversation_id, assembled_at DESC);

-- One active (approved) session per conversation. Proposed (approved_at IS NULL)
-- sessions can exist multiple times — JB might cancel and reassemble before approving.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_higgins_team_active_per_conv
  ON higgins_team_sessions(conversation_id)
  WHERE approved_at IS NOT NULL;

ALTER TABLE higgins_team_sessions ENABLE ROW LEVEL SECURITY;
-- No policies = deny-by-default for anon; service role bypasses RLS (mirrors REQ-002 pattern).

-- ============================================
-- higgins_artifacts.contributing_agents — REQ-004 §8
-- Hierarchical attribution captured at artifact-create time.
-- ============================================
ALTER TABLE higgins_artifacts
  ADD COLUMN IF NOT EXISTS contributing_agents JSONB;
