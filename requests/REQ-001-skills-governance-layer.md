# REQ-001 — Skills Governance Layer

**Owner:** JB Herrera
**Drafted by:** Higgins
**Date:** 2026-05-18
**Status:** Approved — decisions closed 2026-05-18. Phases 1–3 ✅, Phase 4 ✅ (closed 2026-05-21 via REQ-004 Phase 1), Phase 5 still open (synergi-skills-updater repoint + Sunday cron).
**Project:** ai-tools/skills + synergi-skills-updater + AIDevelopment/.agents/skills

---

## 1. Problem

Synergi has a growing library of ~74 generic agents ("skills") in `AIDevelopment/.agents/skills/`, plus a continuous pipeline of new skill candidates from Anthropic releases, open-source repos, and the `synergi-skills-updater` discovery service. Today:

- The skills are **uncatalogued** — no metadata, no versioning, no review trail. The folder is a flat directory of 74 names.
- The updater service exists but cannot run safely on a schedule because there's **no review gate** between "discovered" and "available."
- **Higgins 2.0** (the agentic interface at `/higgins2`) needs to pull from a *governed* source of skills, not a raw directory, but the registry layer that would serve it isn't connected.
- There is no place where curator-JB can answer "what skills exist, what changed this week, which version is current, which ones are mine to maintain vs. pass-through."

Without this layer, the skills library degrades over time: untracked, undifferentiated, and unsafe to feed an autonomous interface like Higgins 2.0.

## 2. Strategic intent

Position Synergi as a **curator** of values-aligned AI skills, not just a builder of them. The governance layer is the moat: anyone can publish skills; few maintain weekly review discipline against an explicit values screen. The Sunday review ritual is part of the brand promise, not just engineering hygiene.

## 3. Users

| User | Job-to-be-done | Frequency |
|---|---|---|
| **Curator-JB** | Review pending skills, approve/reject/edit versions, manage the canonical library. | Weekly (Sunday after cron) |
| **Higgins 2.0** (API consumer) | Discover what skills are currently approved; load the right skill for a given task. | Per agent invocation |
| **Future v2+: i360 client deployments** | Pick from the catalog when configuring a client instance. | Per onboarding |
| **Future v2+: Other Synergi repos** | Install Anthropic-derived utility skills (artifact creation, etc.) into their own `.claude/skills/`. | As needed |
| **Future v2+: Public visitors** | Browse "skills curated by JB Herrera" as a thought-leadership artifact. | Open question |

V1 ships for the first two users only. Everything else is deferred.

## 4. Goals & success metrics

| Goal | Metric | Target |
|---|---|---|
| The Sunday cron runs safely | Cron runs unattended for 4 consecutive weeks without polluting the registry | 4 weeks |
| Curator reviews stay sustainable | Time-to-review per pending skill | < 90 seconds |
| Higgins 2.0 consumes only governed skills | % of skills served via API that have `review_status='approved'` | 100% |
| The full library is represented | 74 existing `.agents/skills/` folders backfilled into Supabase | 74 / 74 |
| Versioning is observable | Every skill has at least one version row with a content hash | 100% coverage |

## 5. In scope (v1)

1. Schema extension to `skill_registry` (see §8).
2. Backfill of the 74 existing `.agents/skills/` folders into Supabase.
3. **Matching engine v1** — content-hash + keyword-overlap similarity (no LLM). Called by the updater before insertion to decide "new version of X" vs. "new skill."
4. **Curator UX polish** — bulk approve, version diff view, keyboard-driven review flow on `/skills`.
5. **Higgins 2.0 API integration** — read-only consumption of `GET /api/skills?status=approved&scope=...`.
6. **Updater write path** — `synergi-skills-updater` writes file content to `.agents/skills/`, writes metadata rows to Supabase with `review_status='pending'`.
7. **Audit trail** — every approval/rejection logs reviewer + timestamp + notes (already in `skill_matches`; extend to skill versions themselves).

## 6. Out of scope (v2+)

- CLI for installing skills into other repos (`synergi-skills install ...`).
- MCP server for live skill streaming.
- Multi-tenancy / per-client skill scoping.
- Public catalog page (skill library as marketing surface).
- LLM-assisted matching (semantic similarity beyond keywords).
- In-UI skill authoring (create new skill from the page).
- Pass-through skill maintenance (PM-skills, Anthropic) — registry tracks them as **references**, not maintained copies.

## 7. MVP cut — the smallest version that closes the loop

Three things must all be true for v1 to ship:

1. **Cron-safe.** Sunday cron can run because there's a matching engine + review gate. Nothing leaks to Higgins 2.0 unreviewed.
2. **Backfilled.** All 74 skills are in Supabase with `review_status='approved'`, `current_version='1.0.0'`, content hashes captured.
3. **Consumed.** Higgins 2.0 successfully calls `/api/skills?status=approved` and uses the returned list to populate its agent options.

Anything that doesn't serve those three is post-v1.

## 8. Schema deltas

Additions to `skill_registry`:

| Field | Type | Purpose |
|---|---|---|
| `scope` | enum: `universal` \| `domain-generic` \| `project-specific` | Where this skill is reusable. Defaults to `domain-generic` for the existing 74. |
| `source_type` | enum: `synergi-original` \| `anthropic-derived` \| `open-source-passthrough` | Who owns/maintains this skill. Drives review treatment. |
| `file_path` | text | Filesystem path relative to repo root (e.g., `.agents/skills/biz-finance`). |
| `upstream_url` | text, nullable | For pass-through skills, the source URL we're tracking. |
| `review_status` | enum: `approved` \| `pending` \| `rejected` | Already exists on `skill_matches`; lift to the skill version level. |

Additions to `skill_sources`:

- New `type` enum value: `passthrough` (alongside existing `core` and `expert-repo`).

New table or extension: **per-version review status.**

Currently `skill_registry.versions` is a JSONB array. Either:
- (a) Add `review_status` and `reviewed_at` inside each JSONB version entry, or
- (b) Promote versions to their own table `skill_versions` with a foreign key to `skill_registry`.

**Recommendation: (b).** Easier to query, audit, and index. JSONB versioning was fine when versions were passive; now they need review-gated lifecycle, which means relational treatment.

## 9. Phased delivery plan

| Phase | Deliverable | Estimated effort |
|---|---|---|
| **0 — Prereqs** | Re-create `requests/`, resolve open question on origin-vs-scope axis, finalize schema delta. | 1 session |
| **1 — Foundation** | Schema migration (additions in §8), backfill script for 74 skills, smoke-test via `/api/skills/stats`. | 1–2 sessions |
| **2 — Matching engine** | Content-hash + keyword-overlap matcher in `api/skills.py` (or `lib/`). Tested against synthetic "new version of existing" + "brand new" cases. | 2 sessions |
| **3 — Curator UX** | Bulk approve, version diff, keyboard nav on `/skills`. Goal: 90-second-per-skill review. | 2 sessions |
| **4 — Higgins 2.0 hookup** ✅ *closed 2026-05-21 via REQ-004 Phase 1* | API integration in `/higgins2`. Implemented as DB-backed catalog injection: `api/lib/skillCatalog.ts` loads the three tiered pools (orchestrators / cross-functional / exec_team) with a 5-min cache; `api/lib/higginsSystemPrompt.ts` composes the exec-orchestrator base + runtime overlay + tiered catalog at each chat turn. | 1–2 sessions |
| **5 — Cron live** | `synergi-skills-updater` configured to write to Supabase, scheduled for Sunday, monitored for 4 weeks. | 1 session + 4-week soak |

Total to v1-shipped: **6–8 working sessions plus a 4-week soak period.**

## 10. Decisions (closed 2026-05-18)

All five resolved per JB's approval of the original recommendations:

1. **Origin vs. scope = two axes.** `source_type` captures ownership (Synergi-original | Anthropic-derived | open-source-passthrough); `scope` captures reusability (universal | domain-generic | project-specific). They correlate but are distinct.

2. **Backfill state = auto-approved at v1.0.0.** The 74 existing `.agents/skills/` folders are the current production state and land as approved. The Sunday cron's review-gate applies only to *new or changed* skills going forward.

3. **Pass-through skills = full DB rows.** Anthropic-derived and open-source-passthrough skills get rows in `skill_registry` with `source_type` tagged appropriately and `upstream_url` populated. Higgins 2.0 queries them the same way as Synergi-originals.

4. **Higgins 2.0 runtime model = decide in Phase 4.** Not blocking v1. Schema doesn't preconfigure a model; Phase 4 design picks between "all approved skills always available," "per-agent-invocation selection," or "task-type-scoped."

5. **Pass-through update tracking = v2.** v1 just stores `upstream_url`. v2 will add the weekly drift-detection check that surfaces upstream changes into the review queue.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Sunday cron pollutes the registry before review UX is fast enough | Don't enable cron until Phase 5. Test against staging Supabase first. |
| Matching engine misclassifies "new" as "version of existing" → silently overwrites | Always require human approval for version replacement. Matcher only *suggests*. |
| Schema migration breaks the existing `/skills` admin page | Migrate additively (no column drops). Test on staging Supabase before pushing. |
| Higgins 2.0 consumes the API faster than reviews can keep up → bottleneck on JB's Sundays | If review queue >25 items, scale back updater discovery aggressiveness. |
| `.agents/skills` and Supabase metadata drift out of sync | Backfill script is re-runnable; add a `verify-sync` admin endpoint that compares filesystem vs. DB. |

## 12. Dependencies

- **Supabase project** running with the existing `skills_schema.sql`. (Confirm it's been applied — verify in Phase 0.)
- **synergi-skills-updater** has Supabase write credentials.
- **Higgins 2.0** is reachable from a routing standpoint and has space in its UI for skill discovery.
- **`.agents/skills/`** stays at its current path. If the path moves, the backfill script and updater both need updating.

## 13. Definition of done (v1)

- [ ] Schema delta migrated and live in Supabase.
- [ ] 74 `.agents/skills/` folders ingested with metadata + content hashes.
- [ ] Matching engine v1 callable from updater, with passing test cases.
- [ ] Curator review UX achieves <90s per skill in a timed test.
- [ ] Higgins 2.0 calls `/api/skills?status=approved` and uses the response.
- [ ] Updater scheduled to run Sundays and successfully writes pending entries.
- [ ] 4 consecutive weeks of unattended Sunday runs with no production incidents.
- [ ] This REQ is moved to `requests/archive/` with a one-line "completed" header.

---

## Appendix A — Current state inventory

| Component | Status | Location |
|---|---|---|
| Skill files (74) | Exists, uncatalogued | `AIDevelopment/.agents/skills/` |
| Skills schema | Designed, presumed applied | `db/skills_schema.sql` |
| Public read API | Exists | `api/skills.py` |
| Admin write API | Exists | `api/admin/skills.py` |
| Curator UI shell | Exists, needs UX polish | `public/skills.html` |
| Updater service | Exists, not scheduled, not writing to registry yet | `synergi-skills-updater/` (separate repo) |
| Matching engine | Does not exist | — |
| Higgins 2.0 consumer integration | Does not exist | `public/higgins2.html` |
| Backfill script | Does not exist | — |

## Appendix B — Naming convention observed in `.agents/skills/`

Folders follow `${department}-${name}` pattern, mapping cleanly to existing `department` column:

- `biz-*` — business (customer success, data, finance, follow-up, legal, partnerships, pricing, shared, strategy)
- `exec-*` — executive (chief of staff, orchestrator, shared, strategic advisor)
- `fin-*` — finance (budget forecast, compliance, controller, orchestrator, reporting, revenue ops, shared)
- `hr-*` — human resources (compensation, culture, …)

Backfill should parse the prefix as `department`, the suffix as `slug`.
