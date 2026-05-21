-- ============================================
-- Skills Registry — v2 (governance layer)
-- Per REQ-001: ai-tools/requests/REQ-001-skills-governance-layer.md
-- + REQ-003 additions: ai-tools/requests/REQ-003-skill-dependency-tracking.md
--
-- This file is the canonical "fresh-start" representation of the schema.
-- For incremental application to an existing DB, use db/migrations/*.sql.
--
-- Applied to production: 2026-05-18 (REQ-001 v2), 2026-05-19 (REQ-003 deps).
-- Run in Supabase SQL Editor or via psql.
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── updated_at trigger function (defensive) ──
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Drop prior types and tables (production verified empty) ──
DROP VIEW IF EXISTS skill_dependent_count CASCADE;
DROP VIEW IF EXISTS skill_dependency_graph CASCADE;
DROP VIEW IF EXISTS skill_stats CASCADE;
DROP VIEW IF EXISTS skill_match_stats CASCADE;
DROP VIEW IF EXISTS skill_version_stats CASCADE;
DROP TABLE IF EXISTS skill_dependencies CASCADE;
DROP TABLE IF EXISTS skill_adoptions CASCADE;
DROP TABLE IF EXISTS skill_matches CASCADE;
DROP TABLE IF EXISTS skill_versions CASCADE;
DROP TABLE IF EXISTS skill_registry CASCADE;
DROP TABLE IF EXISTS skill_sources CASCADE;
DROP TYPE IF EXISTS skill_source_type CASCADE;
DROP TYPE IF EXISTS skill_origin CASCADE;
DROP TYPE IF EXISTS skill_scope CASCADE;
DROP TYPE IF EXISTS review_status CASCADE;

-- ============================================
-- ENUMS
-- ============================================
CREATE TYPE skill_source_type AS ENUM (
  'core',          -- Synergi-owned source (e.g. core-synergi)
  'expert-repo',   -- External curated repo (e.g. pm-skills fork)
  'passthrough'    -- Track upstream; we do not maintain a copy
);

CREATE TYPE skill_origin AS ENUM (
  'synergi-original',         -- We author + maintain
  'anthropic-derived',        -- Sourced from Anthropic releases
  'open-source-passthrough'   -- External, tracked as reference
);

CREATE TYPE skill_scope AS ENUM (
  'universal',          -- Useful in any repo / project
  'domain-generic',     -- Generic within a domain (i360, biz, etc.)
  'project-specific'    -- Lives inside a single project repo
);

CREATE TYPE review_status AS ENUM (
  'approved',
  'pending',
  'rejected'
);

-- ============================================
-- SKILL SOURCES
-- One row per origin (Synergi core, PM-skills fork, Anthropic feed, etc.)
-- ============================================
CREATE TABLE skill_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type skill_source_type NOT NULL,
  author_name TEXT,
  author_email TEXT,
  author_url TEXT,
  license TEXT,
  repo_url TEXT,
  upstream_url TEXT,         -- For tracking external sources
  department TEXT,
  last_scanned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- SKILL REGISTRY
-- One row per skill (the canonical metadata record)
-- ============================================
CREATE TABLE skill_registry (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  skill_id TEXT NOT NULL UNIQUE,           -- e.g. 'core-synergi/biz-finance'
  slug TEXT NOT NULL,                       -- e.g. 'biz-finance'
  name TEXT NOT NULL,
  description TEXT,
  department TEXT,                          -- Parsed from slug prefix
  category TEXT,
  source_id UUID REFERENCES skill_sources(id) ON DELETE CASCADE,

  -- New axes per REQ-001 §10 (decisions closed 2026-05-18)
  source_type skill_origin NOT NULL DEFAULT 'synergi-original',
  scope skill_scope NOT NULL DEFAULT 'domain-generic',

  file_path TEXT,                           -- Repo-relative, e.g. '.agents/skills/biz-finance'
  upstream_url TEXT,                        -- For pass-through skills

  author_name TEXT,
  license TEXT,
  current_version TEXT DEFAULT '1.0.0',     -- Points at the currently promoted version
  content_hash TEXT,                        -- Hash of the current version's content
  has_command BOOLEAN DEFAULT false,
  keywords TEXT[] DEFAULT '{}',

  -- REQ-004 additions (migration 003) — team assembly + DB-mirrored content
  tier TEXT,                                -- 'top' | 'orchestrator' | 'specialist' | 'shared' | 'cross_functional'
  display_name TEXT,                        -- Character name (Dakota, Marlowe…); falls back to name
  tagline TEXT,                             -- ≤80 chars, team-assembly card subtitle
  avatar_url TEXT,                          -- Vercel Blob URL; NULL → generated monogram fallback
  content TEXT,                             -- Full SKILL.md body — DB mirror for Vercel runtime
  last_seen_at TIMESTAMPTZ,                 -- Last sync_skills.py run that observed this slug on disk

  discovered_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_skill_registry_source       ON skill_registry(source_id);
CREATE INDEX idx_skill_registry_dept         ON skill_registry(department);
CREATE INDEX idx_skill_registry_source_type  ON skill_registry(source_type);
CREATE INDEX idx_skill_registry_scope        ON skill_registry(scope);
CREATE INDEX idx_skill_registry_keywords     ON skill_registry USING GIN(keywords);
CREATE INDEX idx_skill_registry_tier         ON skill_registry(tier);
CREATE INDEX idx_skill_registry_last_seen_at ON skill_registry(last_seen_at);

-- ============================================
-- SKILL VERSIONS
-- One row per (skill, version) — the review-gated lifecycle table.
-- Promoted from the JSONB array in v1 per REQ-001 §8.
-- ============================================
CREATE TABLE skill_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  skill_id UUID NOT NULL REFERENCES skill_registry(id) ON DELETE CASCADE,
  version TEXT NOT NULL,                    -- e.g. '1.0.0'
  content_hash TEXT NOT NULL,
  change_type TEXT,                         -- 'initial' | 'patch' | 'minor' | 'major'

  review_status review_status NOT NULL DEFAULT 'pending',
  reviewer_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,

  discovered_at TIMESTAMPTZ DEFAULT now(),
  promoted_at TIMESTAMPTZ,                  -- When this version became current
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(skill_id, version)
);

CREATE INDEX idx_skill_versions_skill   ON skill_versions(skill_id);
CREATE INDEX idx_skill_versions_status  ON skill_versions(review_status);

-- ============================================
-- SKILL MATCHES
-- Pairs proposed by the matching engine (Phase 2).
-- 'new_version' = candidate is a new version of an existing skill
-- 'duplicate'   = candidate is the same skill from another source
-- 'similar'     = related but distinct
-- ============================================
CREATE TABLE skill_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_skill_id UUID REFERENCES skill_registry(id) ON DELETE CASCADE,
  matched_skill_id   UUID REFERENCES skill_registry(id) ON DELETE CASCADE,
  match_type TEXT,
  confidence NUMERIC(5,4) DEFAULT 0,
  reasoning TEXT,
  review_status review_status NOT NULL DEFAULT 'pending',
  reviewer_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_skill_matches_candidate ON skill_matches(candidate_skill_id);
CREATE INDEX idx_skill_matches_matched   ON skill_matches(matched_skill_id);
CREATE INDEX idx_skill_matches_status    ON skill_matches(review_status);
CREATE UNIQUE INDEX idx_skill_matches_pair ON skill_matches(candidate_skill_id, matched_skill_id);

-- ============================================
-- SKILL ADOPTIONS
-- Log of skills that have been adopted (made available to consumers).
-- ============================================
CREATE TABLE skill_adoptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  skill_id UUID REFERENCES skill_registry(id) ON DELETE CASCADE,
  adopted_at TIMESTAMPTZ DEFAULT now(),
  adopted_version TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_skill_adoptions_skill ON skill_adoptions(skill_id);

-- ============================================
-- SKILL DEPENDENCIES (REQ-003)
-- Edges: (skill_id depends on depends_on_id). Standard DAG convention.
-- One row per markdown link from one registry entry to another.
-- ============================================
CREATE TABLE skill_dependencies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  skill_id      UUID NOT NULL REFERENCES skill_registry(id) ON DELETE CASCADE,
  depends_on_id UUID NOT NULL REFERENCES skill_registry(id) ON DELETE CASCADE,
  link_text TEXT,
  link_target TEXT,
  link_kind TEXT NOT NULL DEFAULT 'inline-markdown',
  resolved_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(skill_id, depends_on_id)
);

CREATE INDEX idx_skill_deps_skill      ON skill_dependencies(skill_id);
CREATE INDEX idx_skill_deps_depends_on ON skill_dependencies(depends_on_id);

-- ============================================
-- TRIGGERS
-- ============================================
CREATE TRIGGER skill_sources_updated_at
  BEFORE UPDATE ON skill_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER skill_registry_updated_at
  BEFORE UPDATE ON skill_registry
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER skill_versions_updated_at
  BEFORE UPDATE ON skill_versions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER skill_matches_updated_at
  BEFORE UPDATE ON skill_matches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER skill_dependencies_updated_at
  BEFORE UPDATE ON skill_dependencies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY
-- Public read everything; service role full access for writes.
-- ============================================
ALTER TABLE skill_sources       ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_registry      ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_versions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_matches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_adoptions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_dependencies  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read skill_sources"       ON skill_sources       FOR SELECT USING (true);
CREATE POLICY "Public read skill_registry"      ON skill_registry      FOR SELECT USING (true);
CREATE POLICY "Public read skill_versions"      ON skill_versions      FOR SELECT USING (true);
CREATE POLICY "Public read skill_matches"       ON skill_matches       FOR SELECT USING (true);
CREATE POLICY "Public read skill_adoptions"     ON skill_adoptions     FOR SELECT USING (true);
CREATE POLICY "Public read skill_dependencies"  ON skill_dependencies  FOR SELECT USING (true);

CREATE POLICY "Service full access skill_sources"       ON skill_sources       FOR ALL USING (true);
CREATE POLICY "Service full access skill_registry"      ON skill_registry      FOR ALL USING (true);
CREATE POLICY "Service full access skill_versions"      ON skill_versions      FOR ALL USING (true);
CREATE POLICY "Service full access skill_matches"       ON skill_matches       FOR ALL USING (true);
CREATE POLICY "Service full access skill_adoptions"     ON skill_adoptions     FOR ALL USING (true);
CREATE POLICY "Service full access skill_dependencies"  ON skill_dependencies  FOR ALL USING (true);

-- ============================================
-- VIEWS
-- Drive the dashboard tiles on /skills.
-- ============================================
CREATE VIEW skill_stats AS
SELECT
  COUNT(*)                                                       AS total_skills,
  COUNT(*) FILTER (WHERE source_type = 'synergi-original')       AS synergi_skills,
  COUNT(*) FILTER (WHERE source_type = 'anthropic-derived')      AS anthropic_skills,
  COUNT(*) FILTER (WHERE source_type = 'open-source-passthrough') AS opensource_skills,
  COUNT(*) FILTER (WHERE scope = 'universal')                    AS universal_skills,
  COUNT(*) FILTER (WHERE scope = 'domain-generic')               AS domain_skills,
  COUNT(*) FILTER (WHERE scope = 'project-specific')             AS project_skills,
  COUNT(*) FILTER (WHERE has_command)                            AS command_skills,
  COUNT(DISTINCT department)                                     AS departments
FROM skill_registry;

CREATE VIEW skill_version_stats AS
SELECT
  COUNT(*)                                              AS total_versions,
  COUNT(*) FILTER (WHERE review_status = 'pending')     AS pending_reviews,
  COUNT(*) FILTER (WHERE review_status = 'approved')    AS approved,
  COUNT(*) FILTER (WHERE review_status = 'rejected')    AS rejected
FROM skill_versions;

CREATE VIEW skill_match_stats AS
SELECT
  COUNT(*)                                              AS total_matches,
  COUNT(*) FILTER (WHERE review_status = 'pending')     AS pending_reviews,
  COUNT(*) FILTER (WHERE review_status = 'approved')    AS approved,
  COUNT(*) FILTER (WHERE review_status = 'rejected')    AS rejected
FROM skill_matches;

-- skill_dependency_graph: one row per edge, with both ends' metadata.
CREATE VIEW skill_dependency_graph AS
SELECT
  d.id                    AS edge_id,
  d.skill_id,
  s.slug                  AS skill_slug,
  s.name                  AS skill_name,
  s.department            AS skill_department,
  d.depends_on_id,
  t.slug                  AS depends_on_slug,
  t.name                  AS depends_on_name,
  t.department            AS depends_on_department,
  t.category              AS depends_on_category,
  d.link_kind,
  d.link_text,
  d.link_target,
  d.resolved_at
FROM skill_dependencies d
JOIN skill_registry s ON s.id = d.skill_id
JOIN skill_registry t ON t.id = d.depends_on_id;

-- skill_dependent_count: how many things depend on each entry — drives blast-radius indicators.
CREATE VIEW skill_dependent_count AS
SELECT
  d.depends_on_id,
  COUNT(*) AS dependent_count
FROM skill_dependencies d
GROUP BY d.depends_on_id;
