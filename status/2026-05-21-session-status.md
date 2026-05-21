# Session Status — 2026-05-21

**Session window:** 2026-05-19 → 2026-05-21
**Owner:** JB Herrera
**Author:** Higgins
**Project:** ai-tools (repo: github.com/jbherrera17/ai-tools)
**Production:** Vercel — `idb-projects/ai-tools` (latest deployment auto-promoted on push to `main`)
**Picks up from:** [`2026-05-19-session-status.md`](./2026-05-19-session-status.md)

---

## Executive summary

Two major workstreams closed:

1. **REQ-002 (Higgins 2.0 Chat + Floating Artifact Windows) — SHIPPED end-to-end.** All 6 phases live in production at `https://ai.jbherrera.com/higgins2`. Phases 4–6 completed since the last status (DocX + PPTX server-render to Vercel Blob, pgvector memory recall, Phase 6 UI polish + memory inspector + recent conversations sidebar). REQ-002 moved to `requests/archive/`.
2. **REQ-004 (Agent Team Assembly for Higgins 2.0) — SPEC LOCKED.** Today (2026-05-21) walked §12 with JB. All 7 open decisions resolved. The walkthrough surfaced significant architectural insights — the existing `.agents/skills/` filesystem already documents a 3-tier hierarchical agent architecture (Higgins as exec-orchestrator → 6–7 dept orchestrators → 50+ leaf specialists, plus 8 cross-functional biz-* helpers). REQ-004 rewritten to reflect this. **Ready for Phase 0** (schema deltas + backfill).

REQ-001 still has Phase 4 (Higgins hookup) and Phase 5 (updater repoint + Sunday cron) open. REQ-001 Phase 4 is now **explicitly absorbed into REQ-004** — locked in REQ-004 §11 Phase 1.

---

## What shipped this session

### 2026-05-19 → 2026-05-20 — REQ-002 Phases 4, 5, 6 + archive

- **Phase 4 — DocX + PPTX server-render to Vercel Blob.** `docx@9.6.1` markdown→DocX renderer (Synergi-brand styling, Roboto headings, Poppins body). `pptxgenjs@4.0.1` JSON-deck-spec → PPTX renderer with HIGGINS_MASTER slide master. Vercel Blob wired with `BLOB_READ_WRITE_TOKEN` (existing store connected after hitting the 5-store cap). Patch reconstruction fix: `update_artifact` now stores resolved body, not patch-only, so reload renders correctly.

- **Phase 5 — pgvector memory layer.** `higgins_memories` table + HNSW index on 1536-dim embeddings (`openai/text-embedding-3-small` via AI Gateway). `match_higgins_memories` Postgres function. Four memory tools (`save_memory`, `recall_memory`, `forget_memory`, `summarize_conversation`). Latest user message embedded each turn, top-3 memories recalled at sim ≥ 0.4 and injected as system-prompt block.

- **Phase 6 — UI polish + memory inspector + recent conversations.** Higgins card moved top-left, widened to 480/720px. Mic + waveform removed. Stop button via AbortController. Tool-aware loading text (`TOOL_LABELS` map). Memory inspector modal with kind filter + DELETE buttons (`api/memories.ts`). Recent conversations sidebar wired into Cmd+K palette. `loadConversationHistory` calls `ArtifactWindow.rehydrate(artifacts)`.

- **Archive.** REQ-002 moved to `requests/archive/REQ-002-higgins2-chat-artifacts.md` with completion stamp.

> Commits: `8cda475` (Phase 4), `1e8c59f` (Phase 5), `de30c0c` (Phase 6), `b20a446` (archive + REQ-004 draft)

### 2026-05-21 — REQ-004 spec lock

- Walked all 7 open decisions in REQ-004 §12 with JB. Locked each one in order.
- **Major architectural shift surfaced during Decision 1:** JB clarified the agent system is **3-tier hierarchical**, not flat. Verified this against the filesystem (`~/Documents/AIDevelopment/.agents/skills/`):
  - **8 department orchestrators** confirmed on disk: `exec-`, `fin-`, `hr-`, `mkt-`, `ops-`, `pm-`, `sales-`, `sup-`.
  - **`exec-orchestrator/SKILL.md` IS Higgins's documented persona** — line 6: *"You are Higgins, the Executive Orchestrator for Synergi AI."* Contains 6 documented workflows (WF-EXEC01 through WF-EXEC06) that show the delegation pattern.
  - **`biz-*` skills are cross-functional helpers** (not a department), available to Higgins and any dept orchestrator. Confirmed in exec-orchestrator/SKILL.md §"Cross-Functional Resources (Available to All)".
  - **Character names exist on leaf skills too** — verified by sampling `mkt-brand-voice` (Harper), `mkt-campaign` (Sage), `mkt-icp-adapt` (Avery-M).
- Rewrote REQ-004 doc (242 → 401 lines) to reflect the locked architecture.

> Commit (this session): the REQ-004 rewrite + this status doc.

---

## Current production state

### Higgins 2.0 (live at `/higgins2`)

| Component | State |
|---|---|
| Streaming chat via AI Gateway + Claude Opus 4.7 | ✅ |
| Floating artifact windows (markdown/code/html/table/docx/pptx) | ✅ |
| Vercel Blob storage for DocX/PPTX | ✅ |
| pgvector memory recall (top-3 at sim ≥ 0.4) | ✅ |
| Memory inspector UI + DELETE | ✅ |
| Recent conversations sidebar | ✅ |
| Top-left card placement, 480/720 width, no mic | ✅ |

### Higgins 2.0 schema (`higgins_*` tables, Supabase project `muzwkydkrz...`)

| Table | Purpose |
|---|---|
| `higgins_conversations` | One row per chat |
| `higgins_messages` | Streamed message log |
| `higgins_artifacts` | Artifact metadata |
| `higgins_artifact_versions` | Body snapshots + patches |
| `higgins_memories` | pgvector store with HNSW index |

### Skills Governance (REQ-001) state — unchanged since 2026-05-19

| Table / View | Rows |
|---|---:|
| `skill_registry` | **74** (66 skills + 8 context-references) |
| `skill_dependencies` | 103 |
| `skill_matches` | 6 pending (orchestrator triplet) |

---

## REQ status

| REQ | Title | Status |
|---|---|---|
| **REQ-001** | Skills Governance Layer | Phases 1, 2, 3 (3.0–3.2) ✅ — Phase 4 **absorbed into REQ-004 Phase 1**; Phase 5 (updater repoint + Sunday cron) still open |
| **REQ-002** | Higgins 2.0 Chat + Floating Artifact Windows | ✅ Shipped 2026-05-19, archived |
| **REQ-003** | Skill Dependency Tracking | ✅ Shipped 2026-05-19, archived |
| **REQ-004** | Agent Team Assembly for Higgins 2.0 | **Spec locked 2026-05-21** — ready for Phase 0 |

---

## REQ-004 — Locked architecture (key facts for next session)

### The 3-tier hierarchy

```
Higgins (= exec-orchestrator/SKILL.md — base persona, NOT a hand-rolled template)
   ├── 6–7 Department Orchestrators (Dakota=mkt, Marlowe=fin, etc.) — each is its OWN parallel LLM call
   ├── 8 Cross-functional helpers (Ellis, Kendall, Cameron, Morgan-L, Marley, Skyler, Jordan-B, + biz-customer-success)
   └── 2 Exec team members (Jarvis = chief-of-staff, Alfred = strategic-advisor)

Each Department Orchestrator
   └── 5–10 Leaf specialists (Harper, Sage, Avery-M, etc.) — injected as CONTEXT inside the orchestrator's prompt, NOT separate LLM calls
```

### All 7 §12 decisions — LOCKED

| # | Decision |
|---|---|
| 1 | **Option C — hybrid 3-tier orchestration.** Higgins → parallel dept orchestrator LLM calls → leaf skills as context inside each. Reversible to full B' fan-out via a future `requires_dedicated_call` flag. |
| 2 | **Vercel Blob + SVG monogram fallback** for avatars. v1 ships defaults only. |
| 3 | **Roster size**: 1–3 dept orchestrators (hard cap 4), 0–4 cross-functional (cap 6), 0–2 exec team. 8 cards max. |
| 4 | **Three trigger paths active**: LLM tool-driven + UI button + explicit phrase. All route to `assemble_team` with `intent` tag. |
| 5 | **Option B for mid-task edits**: dept orchestrators locked at approval; cross-functional + exec team open to inline add/remove. |
| 6 | **Two-letter monograms with gradient** on Synergi palette. HG-with-border for Higgins. Hand-designed SVG portraits queued for v2. |
| 7 | **Tiered catalog injection**: Higgins sees ~16 items (orchestrators + biz-* + exec only). Leaf skills load inside their parent dept orchestrator. Plus user-facing attribution footer with character names (Harper, Sage, etc.), not slugs. |

### Confirmed character names (Phase 0 backfill must parse these from SKILL.md frontmatter)

| Skill slug | Character | Department |
|---|---|---|
| `exec-orchestrator` | **Higgins** | Executive (top) |
| `exec-chief-of-staff` | Jarvis | Executive |
| `exec-strategic-advisor` | Alfred | Executive |
| `mkt-orchestrator` | Dakota | Marketing |
| `mkt-brand-voice` | Harper | Marketing |
| `mkt-campaign` | Sage | Marketing |
| `mkt-icp-adapt` | Avery-M | Marketing |
| `fin-orchestrator` | Marlowe | Finance |
| `biz-strategy` | Ellis | Cross-functional |
| `biz-pricing` | Kendall | Cross-functional |
| `biz-finance` | Cameron | Cross-functional |
| `biz-legal` | Morgan-L | Cross-functional |
| `biz-follow-up` | Marley | Cross-functional |
| `biz-data` | Skyler | Cross-functional |
| `biz-partnerships` | Jordan-B | Cross-functional |

The other ~60 character names come from each SKILL.md's `description` frontmatter — parser pattern: `<role> agent (<character>) for the <dept> team` or `<role> — <character>`.

---

## Next steps to completion

Sequenced by what unlocks the most value:

### 1. REQ-004 Phase 0 — Schema deltas + backfill (1 session, NEXT UP)

Apply:
- `skill_registry` extensions: `tier`, `department`, `display_name`, `tagline`, `avatar_url`
- New `higgins_team_sessions` table (hierarchical `roster` JSONB)
- New `higgins_artifacts.contributing_agents` JSONB column

Plus the backfill script that walks `~/Documents/AIDevelopment/.agents/skills/{slug}/SKILL.md`, parses YAML frontmatter, derives `tier` (top/orchestrator/specialist/shared/cross_functional) from slug suffix, derives `department` from slug prefix, extracts `display_name` and `tagline` from description text. Populates all 74 entries.

**Open question for Phase 0:** Skill content lives at workspace root (`~/Documents/AIDevelopment/.agents/skills/`), outside the `ai-tools` repo. The chat backend in `api/chat.ts` needs access. Two options: (a) `SKILLS_ROOT` env var pointing to the workspace path, (b) symlink inside the ai-tools repo. Pick one in Phase 0.

### 2. REQ-004 Phase 1 — Higgins base persona + orchestrator catalog (1 session)

Refactor `api/lib/higginsSystemPrompt.ts` to read `exec-orchestrator/SKILL.md` as Higgins's base. Add catalog filter + tiered directory injection. Smoke test: Higgins names the 6–7 dept orchestrators + 8 biz-* + Jarvis/Alfred correctly. **This closes REQ-001 Phase 4.**

### 3. REQ-004 Phases 2–6 (5–6 sessions)

Per REQ-004 §11. Tool + modal + hierarchical fan-out + attribution + polish. v1-shipped target: 8–9 working sessions from Phase 0.

### 4. REQ-001 Phase 5 — Updater repoint + Sunday cron (~1 session + 4-week soak)

Edit `synergi-skills-updater` to scan `.agents/skills`, POST to `/api/admin/skills/sync`, schedule cron. Independent of REQ-004; can interleave.

### 5. Deferred / optional cleanup (from prior status)

- pm-* `source_type` classification audit (15 min)
- REQ-001 Phase 3 polish: bulk approve/reject on matches, keyboard nav, version diff, retire legacy Suggestions section

---

## Open items / known issues

### REQ-004 Phase 0 — Skill content read path

The 74 SKILL.md files live at `~/Documents/AIDevelopment/.agents/skills/` (workspace root), not in the `ai-tools` repo. Phase 0 must establish how the chat backend reads them. Likely `SKILLS_ROOT` env var (`process.env.SKILLS_ROOT || '../.agents/skills'`) so dev and Vercel prod can diverge. **Resolve in Phase 0.**

### REQ-004 §6 — Hand-designed character portraits (v2)

JB's stated objective: *"the goal is making the agents 'personable' — an image does that better."* Gradient monograms are v1 placeholder. Queued as either a Phase 6 polish task or its own REQ-005 candidate after REQ-004 ships.

### REQ-002 — Stable, no known issues

The full chat-and-artifacts system has been live and JB-exercised since 2026-05-19. No regressions reported.

---

## Memory + Open Brain captures from this session

**Memory file:** `~/.claude/projects/-Users-jbh17-Documents-AIDevelopment-ai-tools/memory/`
- Existing: `project_skills_governance.md` (curator-as-moat)
- No new memory writes this session — REQ-004 spec lock is captured in the REQ doc itself, which is the source of truth

**Open Brain entries (proposed for next session capture):**
- REQ-002 shipped end-to-end (Phases 4, 5, 6 + archive)
- REQ-004 spec locked 2026-05-21 with 3-tier hierarchical orchestration architecture
- Confirmed Higgins = exec-orchestrator/SKILL.md (not a hand-rolled template)
- Character-name attribution as a first-class UX requirement

---

## Risks / open questions for next session

1. **Skill content read path from `api/chat.ts`** — see Open Items above. Resolve in Phase 0.
2. **Roster of 6 vs 7 dept orchestrators by character name** — the exec-orchestrator/SKILL.md lists 6 dept orchestrators by character (Avery, Dakota, Tatum, Marlowe, Sloan, Riley-O); the filesystem has 8 dept orchestrators (exec, fin, hr, mkt, ops, pm, sales, sup). Some dept orchestrators may not yet have character names. Phase 0 backfill will surface which ones are missing.
3. **Existing `higginsSystemPrompt.ts`** — currently a hand-rolled template with `{{TODAY}}` injection. Phase 1 refactor replaces the base content with `exec-orchestrator/SKILL.md`; the `{{TODAY}}` + memory recall append logic stays.

---

_End of status_
