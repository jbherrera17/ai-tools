# Skills Sync — `.agents/skills/` ↔ DB

**Source of truth:** `~/Documents/AIDevelopment/.agents/skills/` (the filesystem).
**Mirror:** the `skill_registry` table in Supabase.
**Direction:** one-way, FS → DB. The DB never feeds back into the filesystem.

## Why a mirror exists

Skills are authored in the filesystem so any harness — Claude CLI, CoWork, Codex, an IDE plugin — can read and write them directly. The DB exists only so the Vercel-hosted Higgins runtime (`api/chat.ts`) and the skills admin UI can see the same content. Vercel functions can't reach the workspace filesystem, so the content has to be mirrored somewhere they *can* reach.

## When to sync

Run `npm run sync-skills` after any change to `.agents/skills/`:

- New skill folder added
- `SKILL.md` body or frontmatter edited
- Supporting files (`examples.md`, `formats.md`, …) edited
- A skill folder removed (sync leaves the DB row but stops touching `last_seen_at` — admin UI can surface stale rows)

Use `npm run sync-skills:dry` to preview what would change without writing.

Future automation (REQ-001 Phase 5): the `synergi-skills-updater` repo will run this same logic on a Sunday cron. Until then, sync is manual.

## What gets synced

Per skill folder:

| Field | Source | Notes |
|---|---|---|
| `slug` | folder name | |
| `name` | SKILL.md frontmatter `name:` | Currently always the slug across the corpus |
| `description` | SKILL.md frontmatter `description:` | |
| `tier` | derived from slug | `top` (exec-orchestrator), `orchestrator` (\*-orchestrator), `exec_team` (exec-chief-of-staff, exec-strategic-advisor), `cross_functional` (biz-\*), `shared` (\*-shared/\*.md context refs), `specialist` (rest) |
| `display_name` | regex `agent (X)` against description | NULL when no character — surfaces curator queue |
| `tagline` | first sentence of description, ≤80 chars, character clause stripped | Drives team-assembly card subtitle |
| `content` | full SKILL.md body | DB mirror for Vercel runtime — see "Why a mirror exists" |
| `content_hash` | SHA-256 of all `.md` files in folder | Drift detection |
| `last_seen_at` | timestamp of this sync run | Stale rows = folder was removed from disk |
| `keywords` | extracted from H2/H3 headings | Stopwords filtered |

## Drift detection (later)

Phase 7 of REQ-004 will add a drift indicator to the `/skills` admin page:

- Rows whose `last_seen_at` is older than the last successful sync → folder removed from disk
- Rows whose disk hash ≠ DB `content_hash` → folder edited but not yet synced
- Rows whose `display_name` is NULL → curator action: assign a character name

Until that ships, run `npm run sync-skills:dry` to inspect the current state.

## Conflict policy

The filesystem always wins. Any direct DB edit to mirrored columns (`content`, `tagline`, etc.) will be overwritten on the next sync. The DB is for *reading* by Higgins; not for editing by anyone.

## See also

- `scripts/sync_skills.py` — the sync implementation
- `db/migrations/003_req004_team_schema.sql` — the schema delta added in REQ-004 Phase 0
- `requests/REQ-004-agent-team-assembly.md` §8 — the field-level spec for the new columns
