# REQ-004 — Agent Team Assembly for Higgins 2.0

**Owner:** JB Herrera
**Drafted by:** Higgins
**Date:** 2026-05-19 (decisions locked 2026-05-21)
**Status:** Spec locked — ready for Phase 0
**Project:** ai-tools (`public/higgins2.html`, new `api/lib/teamTools.ts`, `db/skills_schema.sql` extension)
**Depends on / closes:** REQ-001 (Skills Governance Layer) — **REQ-001 Phase 4 ships as part of this REQ.** When JB says *"Higgins, bring the team together,"* that's the per-agent-invocation selection model REQ-001 deferred to implementation time.

---

## 1. Problem

Higgins 2.0 can chat and produce artifacts (REQ-002), but every response comes from Higgins alone. There's no way to convene the specialist team that has been *intentionally architected* in `~/Documents/AIDevelopment/.agents/skills/` — 8 department orchestrators, 50+ leaf specialists, and 8 cross-functional helpers, each with a character identity and a clear role.

JB's instinct *"bring the team together for an omni-channel marketing campaign"* should:

1. Have Higgins identify which **department orchestrators** are needed (e.g., Marketing → Dakota, Finance → Marlowe).
2. Optionally pull in **cross-functional helpers** (e.g., Kendall for pricing, Morgan-L for legal).
3. Present the proposed team to JB visually.
4. On approval, fan out each department orchestrator as its own LLM call (with its leaf skills injected as context).
5. Aggregate the responses with **attribution by character name**, so JB sees *who* contributed, not just *what*.

Without this:
- The skills governance work (REQ-001) has no human-facing payoff yet.
- Higgins can't differentiate itself from generic chat — every task gets one voice.
- The hierarchical agent architecture sits unused.

## 2. Strategic intent

This is the **product moment** for the Synergi vision: not "an AI assistant" but **"an AI org chart you can convene on demand."** The team assembly UI is the visual proof that Higgins is a curator of specialists, not just a wrapper around Claude. It also gives JB a way to ship the same demo to clients ("here's *your* values-aligned team being assembled in real time") — the foundation for i360 deployments later.

## 3. Users

| User | Job-to-be-done | Frequency |
|---|---|---|
| **JB (primary)** | Convene a relevant agent team for multi-disciplinary work — campaigns, strategic reviews, post-mortems. | Daily |
| **Future: Sales calls / demos** | Show the team-assembly moment as a live differentiator. | Per pitch |
| **Future: i360 client deployments** | Each client gets a roster of their values-aligned agents available on demand. | Per onboarding |

v1 ships for JB only.

## 4. Goals & success metrics

| Goal | Metric | Target |
|---|---|---|
| Team assembly feels intentional, not random | % of `assemble_team` calls where JB keeps the proposed roster (no edits) | ≥ 60% |
| The right specialists get pulled | Manual rubric: 5 sample tasks → expected roster matches actual ≥ 80% of agents (matched by character name) | 4/5 tasks pass |
| Visual moment lands | Time from user prompt → team display rendered | < 3s |
| Skill catalog actually gets used | % of approved skills used at least once in 30 days | ≥ 40% |
| Traceability holds | Every team-assembled response shows the contributing agents by character name | 100% |

## 5. In scope (v1)

The architecture is **3-tier hierarchical** (locked in §12 decision 1):

```
Higgins (= exec-orchestrator/SKILL.md — base persona, not a hand-rolled template)
   ├── 6–7 Department Orchestrators (Dakota=mkt, Marlowe=fin, etc.) — each runs its own LLM call
   ├── 8 Cross-functional helpers (Ellis, Kendall, Cameron, Morgan-L, Marley, Skyler, Jordan-B, +biz-customer-success)
   └── 2 Exec team (Jarvis, Alfred)

Each Department Orchestrator
   └── 5–10 Leaf specialists (Harper, Sage, Avery-M, etc.) — injected as context, not separate LLM calls
```

### In scope:

1. **`assemble_team` tool.** Higgins-side. Given a task, returns a hierarchical proposed roster: which dept orchestrators, which cross-functional helpers, optional exec team. Driven by the LLM (Higgins, using `exec-orchestrator/SKILL.md` as base) with the orchestrator catalog injected as context.

2. **Skills API consumer in Higgins.** Closes **REQ-001 Phase 4.** `api/chat.ts` fetches `GET /api/skills?status=approved` once per request (cached for 5 min in-memory). Filters into three pools — orchestrators, cross-functional, exec team — and injects each as a one-line directory into Higgins's system prompt. Leaf specialists are *not* in Higgins's prompt (they live with their dept orchestrator).

3. **Higgins's base persona = `exec-orchestrator/SKILL.md`.** Read at chat-startup, injected as the foundation of Higgins's system prompt (replaces the hand-rolled template in `higginsSystemPrompt.ts`). Today's date and dynamic memory recall still get appended.

4. **Team assembly UI.** Center-screen modal. Renders agent cards in three rows (orchestrators, cross-functional, exec). Each card shows avatar, character name (Dakota, Marlowe, Kendall…), department, one-line purpose. JB can:
   - **Approve** (continue with this team)
   - **Remove individual agents** (any tier)
   - **Add agents** from the full roster
   - **Cancel** (abort the task)

5. **Avatar storage + defaults.** Each skill row gets an `avatar_url` column. v1 uses pre-generated SVG fallbacks — two-letter monograms on Synergi-palette gradients, deterministic by `skill.id` hash. Higgins's avatar is "HG" with a distinguishing border. Avatars upload to **Vercel Blob** (`higgins/avatars/` prefix). See §10.

6. **Hierarchical orchestration — Option C (locked).** On team approval:
   - Each approved **dept orchestrator** becomes its own parallel `streamText` call.
   - Inside each dept's call: its full `SKILL.md` body + its leaf skills' one-line directory + any cross-functional helpers JB approved get injected as context.
   - Each dept orchestrator returns a structured response: `{response_body, contributing_skills: [character_name, ...]}`.
   - Higgins synthesizes the dept responses into a single user-facing reply.
   - Cross-functional helpers selected at the Higgins level (e.g., Morgan-L for legal review) get context-injected into Higgins's own synthesis turn.

7. **User-facing attribution footer.** Every team-assembled response ends with a collapsible block:

   ```
   — Team that worked on this —
   Dakota (Marketing) · consulted: Harper, Sage, Avery-M
   Marlowe (Finance) · consulted: Cameron, Skyler
   Kendall (Pricing) · cross-functional
   Morgan-L (Legal) · cross-functional
   ```

   Names are the **character names** (e.g., Harper, not `mkt-brand-voice`). Skill slugs are surfaced on hover or in artifact metadata. The footer is auto-collapsed; clicking expands it.

8. **Agent attribution on artifacts.** When an artifact is created during a team task, its title/footer notes the contributing agents by character name. Stored as `higgins_artifacts.contributing_agents` (new JSONB column, hierarchical shape — see §8).

9. **Team session persistence.** The assembled team lives in `higgins_team_sessions` (new table), restored on reload alongside the conversation.

10. **Mid-task team edits (locked Option B in §12 decision 5):** Dept orchestrators are locked at approval. Cross-functional helpers and exec team members can be added/removed inline via natural language ("Higgins, also bring in Morgan-L"). For dept-orchestrator changes, JB types "reassemble the team."

## 6. Out of scope (v2+)

- **Full 3-level fan-out (Option B')** — each leaf skill as its own LLM call. Reversible from Option C if a real expertise-bleeding problem surfaces.
- **Custom JB-uploaded portraits** — v1 uses gradient monogram defaults; uploads come later.
- **Hand-designed SVG character set** — flagged as a polish pass after Phase 6 (or its own REQ). The objective is making agents "personable" — images do that better than monograms long-term.
- Per-client/per-tenant agent rosters.
- Dynamic dept-orchestrator changes mid-task (requires reassembly).
- Agent-to-agent dialogue surfaced in the UI.
- Confidence scores per agent.
- Voice ("Higgins, bring the team together" by voice command — UI button + typed prompt only in v1).

## 7. MVP cut — the smallest version that closes the loop

Four things must all be true:

1. **Catalog flows.** Higgins can see the approved skills filtered into three pools (orchestrators, cross-functional, exec team) on every turn.
2. **Visual assembly moment works.** Saying *"bring the team together for X"* opens the modal with 2–6 proposed agents across the tiers. JB can approve.
3. **Approved team shapes the answer.** With a team approved, Higgins fans out to dept orchestrators in parallel, each runs with its leaf-skill context, results aggregate cleanly.
4. **Attribution is visible.** Every team-assembled response shows *who* contributed by character name, in the footer.

Anything else is layered on after.

## 8. Schema deltas

### `skill_registry` (extend)

| Field | Type | Purpose |
|---|---|---|
| `tier` | text, not null | `'top' \| 'orchestrator' \| 'specialist' \| 'shared' \| 'cross_functional'`. Auto-derived during backfill from slug suffix (`*-orchestrator` → orchestrator, `*-shared` → shared, `biz-*` → cross_functional, `exec-orchestrator` → top). |
| `department` | text, not null | `'exec' \| 'fin' \| 'hr' \| 'mkt' \| 'ops' \| 'pm' \| 'sales' \| 'sup' \| 'biz'`. Auto-derived from slug prefix during backfill. |
| `display_name` | text, nullable | Character name parsed from the `description` frontmatter line (e.g., `"Brand Voice Guardian agent (Harper) for the Marketing team"` → `Harper`). Falls back to `name` if no character. |
| `tagline` | text, nullable | One-line purpose for the team-assembly card. ≤ 80 chars. Auto-extracted from `description` or first SKILL.md heading. |
| `avatar_url` | text, nullable | Vercel Blob URL. NULL → generated gradient monogram fallback. |

### Backfill notes
- Run a one-time migration script that walks `~/Documents/AIDevelopment/.agents/skills/*/SKILL.md`, parses the YAML frontmatter, derives `tier` and `department` from the slug, extracts `display_name` and `tagline` from the description text.
- For Higgins specifically: `tier = 'top'`, `display_name = 'Higgins'`, avatar pinned to the HG-with-border variant.

### New table: `higgins_team_sessions`

```sql
higgins_team_sessions (
  id              uuid primary key,
  conversation_id uuid references higgins_conversations(id) on delete cascade,
  roster          jsonb not null,                  -- hierarchical: see below
  task_summary    text,                            -- "Omni-channel marketing campaign for Q3"
  assembled_at    timestamptz not null default now(),
  approved_at     timestamptz                      -- null until JB approves
);
```

`roster` JSONB shape:

```json
{
  "orchestrators": [
    {"slug": "mkt-orchestrator", "display_name": "Dakota"},
    {"slug": "fin-orchestrator", "display_name": "Marlowe"}
  ],
  "cross_functional": [
    {"slug": "biz-pricing", "display_name": "Kendall"},
    {"slug": "biz-legal", "display_name": "Morgan-L"}
  ],
  "exec_team": []
}
```

One active session per conversation. `approved_at` distinguishes *proposed* from *approved*. Mid-task edits (cross-functional / exec only) update the `roster` JSON in place.

### `higgins_artifacts.contributing_agents` (new column)

```sql
ALTER TABLE higgins_artifacts
  ADD COLUMN contributing_agents jsonb;
```

Hierarchical shape mirroring the team session:

```json
{
  "orchestrators": {
    "mkt-orchestrator": {"display_name": "Dakota", "leaf_consulted": ["Harper", "Sage"]},
    "fin-orchestrator": {"display_name": "Marlowe", "leaf_consulted": ["Cameron"]}
  },
  "cross_functional": ["Kendall", "Morgan-L"]
}
```

## 9. The orchestration question — locked Option C

Three models were considered:

**A — Flat context injection (rejected).** All approved skill content concatenated into one Higgins system prompt; one LLM call per turn. Pros: cheapest, simplest. Cons: **flattens the intentional 3-tier architecture** in `.agents/skills/`. Higgins's `exec-orchestrator/SKILL.md` explicitly describes itself as coordinating *via delegation to dept orchestrators*. Flat injection ignores this design.

**B' — Full 3-level fan-out (rejected for v1).** Higgins → N dept-orchestrator LLM calls → each fans out to M per-skill LLM calls. Per-turn calls for a typical pricing task: 1 + 3 + ~9 ≈ 13 LLM calls. Cost ~10–15× a normal turn; latency ~3× wall-clock. The visual demo would be spectacular (departments huddling internally) but the cost/latency isn't justified for v1.

**C — Hybrid: orchestrator-level fan-out, leaf-as-context (chosen).** Higgins → N dept-orchestrator LLM calls (parallel) → each orchestrator has *its department's leaf skills* injected as context blocks (no further LLM fan-out). Per-turn calls: 1 + N + 1 (synthesis) ≈ 5. Cost ~3–5× a normal turn; latency ~2×. Each dept orchestrator is still a real LLM call — it genuinely orchestrates by selecting which of its leaf skills apply, weighing them, synthesizing for its domain.

**Reversibility:** C → B' is feasible if a specific leaf skill needs its own dedicated reasoning pass. Likely v2 mechanism: a `requires_dedicated_call=true` flag on `skill_registry`. Until then, all leaf skills are context-injected inside their parent orchestrator's prompt.

**Higgins's base persona = `exec-orchestrator/SKILL.md`.** This is the source of truth for Higgins's identity, workflows (WF-EXEC01 through WF-EXEC06), escalation rules, and boundaries. We do NOT maintain a parallel hand-rolled template. The existing `api/lib/higginsSystemPrompt.ts` becomes a thin loader that reads the SKILL.md file and appends dynamic context (today's date, memory recall, orchestrator catalog).

## 10. Avatar storage strategy

| Option | Verdict |
|---|---|
| **Vercel Blob** | ✅ **Chosen.** Already wired in REQ-002 Phase 4 with `BLOB_READ_WRITE_TOKEN`. Public URLs cache cleanly at CDN edge. Same prefix scheme as artifacts (`higgins/avatars/{slug}-v1.png`). |
| Supabase Storage | Plausible — but adds a second blob system, more env config, no clear win. Reject. |
| Static `public/avatars/` | Cheapest but inflexible — skills are added dynamically via the updater; static files would break that flow. Reject. |

### Default avatars (v1)

Generated SVG, server-side, no fetch required. Two-letter monogram on a Synergi-palette gradient:

- **Monogram** — first two letters of `display_name`, uppercase (`Dakota` → `DK`, `Morgan-L` → `MO`, `Higgins` → `HG`).
- **Gradient** — deterministic by `skill.id` hash. Six gradient pairs from the Synergi palette:
  - `#77bde0 → #85ecf8` (cyan)
  - `#b78bd3 → #f0d4fa` (violet)
  - `#dc9171 → #ffe7ba` (amber)
  - `#77bde0 → #b78bd3` (cyan→violet)
  - `#b78bd3 → #dc9171` (violet→amber)
  - `#dc9171 → #77bde0` (amber→cyan)
- **Typography** — DM Serif Display (per personal-tools brand convention, not Synergi business brand).
- **Higgins special case** — "HG" monogram with a 2px solid white border (or subtle ring) to distinguish it as the top-level orchestrator.

### v2+ path

Hand-designed SVG character portraits per agent. **Objective: make agents personable.** Images do this better than monograms long-term. Treated as a polish pass after Phase 6 or as its own REQ (REQ-005 candidate).

## 11. Phased delivery plan

| Phase | Deliverable | Effort |
|---|---|---|
| **0 — Schema deltas** | Apply `skill_registry` extensions (`tier`, `department`, `display_name`, `tagline`, `avatar_url`) + new `higgins_team_sessions` table + `higgins_artifacts.contributing_agents` JSONB column. Run backfill script that parses all SKILL.md frontmatter and populates the new fields. | 1 session |
| **1 — Higgins base persona + orchestrator catalog** | (a) Refactor `higginsSystemPrompt.ts` to read `exec-orchestrator/SKILL.md` as base. (b) `api/chat.ts` fetches approved skills, caches 5 min, filters into three pools, injects as tiered directory. (c) Smoke test: Higgins can correctly name the 6–7 dept orchestrators, the 8 biz-* helpers, and Jarvis/Alfred when asked. **Closes REQ-001 Phase 4.** | 1 session |
| **2 — `assemble_team` tool + default avatars** | (a) New tool in `api/lib/teamTools.ts`. LLM picks orchestrators / cross-functional / exec-team given the task and catalog. Writes `higgins_team_sessions` row with `approved_at = NULL`. (b) SVG monogram generator endpoint serving gradient defaults. (c) JB approves visual quality of 5 sample default avatars before Phase 3. | 1 session |
| **3 — Team assembly modal UI** | Center-screen overlay rendering agent cards on `tool-output-available`. Three rows (orchestrators / cross-functional / exec). Approve / Cancel / Remove individual agents. On approve: PATCH the session row with `approved_at = now()`. Modal animation polish. | 2 sessions |
| **4 — Hierarchical orchestration + attribution** | (a) On approved team, each dept orchestrator becomes a parallel `streamText` call with its full SKILL.md + leaf directory + selected cross-functional helpers as context. (b) Structured response format: `{response_body, contributing_skills: [character_name, ...]}`. (c) Higgins synthesizes across dept responses. (d) `agents_active` indicator badges in card header. (e) Mid-task add/remove for cross-functional + exec team via natural language. | 2 sessions |
| **5 — User-facing attribution footer + artifact attribution** | (a) Collapsible "Team that worked on this" footer on every team-assembled response, character names lead. (b) Populate `higgins_artifacts.contributing_agents` JSONB from active session on tool execute. (c) Surface attribution in artifact window footer. | 1 session |
| **6 — Polish + voice rubric** | Animate the team-assembly modal. Run 5-task rubric (see Appendix A). Tune the catalog-injection prompt if Higgins over-recruits. QA the attribution display. | 1 session |

**Total to v1-shipped: 8–9 working sessions.**

## 12. Open decisions — LOCKED 2026-05-21

| # | Question | Resolution |
|---|---|---|
| 1 | Orchestration model | **Locked: Option C — hybrid 3-tier.** Higgins (= `exec-orchestrator/SKILL.md`) → parallel dept orchestrator LLM calls → leaf skills as context inside each. Reversible to B' via `requires_dedicated_call` flag if needed in v2. See §9. |
| 2 | Avatar storage | **Locked: Vercel Blob + SVG monogram fallback.** v1 ships defaults only. Hand-designed portraits → v2 polish or own REQ. See §10. |
| 3 | Roster size guardrails | **Locked: 1–3 dept orchestrators (hard cap 4), 0–4 cross-functional (cap 6), 0–2 exec team. 8 cards max on modal.** Soft guidance: aim for 3–5 cards total. |
| 4 | Team trigger phrase | **Locked: all three paths active.** LLM tool-driven + UI button + explicit phrase. All route to `assemble_team` with `intent: "auto" \| "explicit_button" \| "explicit_phrase"`. |
| 5 | Mid-task team edits | **Locked: Option B.** Dept orchestrators locked at approval (require "reassemble the team"). Cross-functional + exec team open to inline add/remove via natural language. |
| 6 | Default avatar style | **Locked: two-letter monogram with gradient.** Six gradient pairs from Synergi palette, deterministic by `skill.id` hash. HG with border for Higgins. v2 ambition: hand-designed SVG portraits per character to make agents personable. |
| 7 | Skill catalog injection format | **Locked: tiered.** Higgins's prompt carries ~16-item directory (orchestrators + biz-* + exec team only). Leaf skills load inside their parent dept orchestrator. **Plus: every team-assembled response includes a user-facing attribution footer using character names (Harper, Sage, etc.), not slugs.** |

## 13. Risks

| Risk | Mitigation |
|---|---|
| Higgins picks the wrong team for the task | 5-task evaluation rubric (Appendix A) run after each prompt tune. Bar set in §4 success metrics (4/5 tasks pass). |
| Higgins's exec-orchestrator SKILL.md is delegate-heavy → over-recruits team | The `assemble_team` tool's own prompt sets a bar: *"Only assemble a team when the task requires expertise from 2+ distinct departments OR when JB explicitly asks. For single-domain questions, answer directly."* Monitored in Phase 2 testing. |
| ~16-item orchestrator catalog blows the system prompt | One-line per item × 16 ≈ 1.5K tokens. Trivial vs. Opus's 1M context. |
| Dept orchestrator's full SKILL.md + leaf directory + helpers overflow that orchestrator's prompt | Hard cap: orchestrator SKILL.md (~3K) + 10 leaf lines (~1K) + up to 4 cross-functional helper SKILL.md snippets (~6K) + Higgins task brief (~1K) = ~11K. Within budget; monitored in Phase 4. |
| The visual moment feels gimmicky | Hard rule (above): only assemble when warranted. JB-driven button gives explicit intent when desired. |
| Default avatars look generic / hurt the "personable" goal | Phase 2 — render 8 default avatars (Higgins + 7 dept orchestrators) side-by-side; JB approves before Phase 3. Hand-designed v2 portraits queued. |
| `higgins_team_sessions` writes leak across conversations | `conversation_id` required and indexed. Unique constraint on `(conversation_id, approved_at IS NOT NULL)` for active sessions. |
| Parallel dept-orchestrator LLM calls fail individually | Per-call error wrapping; Higgins synthesizes around any single failure with a noted-as-missing line in the attribution footer. |

## 14. Dependencies

- **REQ-001 schema** applied (✅ done 2026-05-18).
- **REQ-002 chat infrastructure** live (✅ shipped 2026-05-19).
- **Skill catalog populated** — the ~74 backfilled skills must be `review_status='approved'` (✅ per REQ-001).
- **Skill `SKILL.md` files** accessible to the server. Phase 0 verifies the read path works from `api/chat.ts`. (Location: `~/Documents/AIDevelopment/.agents/skills/{slug}/SKILL.md` — workspace-level, outside the ai-tools repo. May require a `SKILLS_ROOT` env var or symlink.)
- **Vercel Blob** (✅ wired in REQ-002 Phase 4).

## 15. Definition of done (v1)

- [ ] Schema delta applied: `skill_registry` extensions (`tier`, `department`, `display_name`, `tagline`, `avatar_url`) + `higgins_team_sessions` + `higgins_artifacts.contributing_agents` JSONB.
- [ ] Backfill script populated all 74 skills with `tier`, `department`, and `display_name` parsed from existing SKILL.md frontmatter.
- [ ] `api/chat.ts` consumes `/api/skills?status=approved`, caches 5 min, filters into three pools (orchestrators / cross-functional / exec), injects tiered directory.
- [ ] `higginsSystemPrompt.ts` now loads `exec-orchestrator/SKILL.md` as Higgins's base persona.
- [ ] **REQ-001 Phase 4 marked complete** in its archived REQ.
- [ ] `assemble_team` tool defined, callable, picks accurate teams in 4/5 sample-task tests.
- [ ] Team-assembly modal renders 3-row card layout (orchestrators / cross-functional / exec), allows approve / cancel / remove-agent.
- [ ] On approved team, dept orchestrators fan out in parallel; each runs with leaf skill context injected; structured responses aggregate to Higgins.
- [ ] User-facing attribution footer renders on every team-assembled response with character names.
- [ ] Artifacts generated during an active team session populate `contributing_agents` JSONB and surface attribution in the window footer.
- [ ] Default gradient SVG avatars render for all 74 backfilled skills; HG with border for Higgins.
- [ ] "Bring the team together" button visible in the card header, triggers `assemble_team` with the latest user message as context.
- [ ] Mid-task: cross-functional helpers + exec team can be added/removed inline via natural language. Dept-orchestrator changes require "reassemble the team."
- [ ] Deployed to production at `https://ai.jbherrera.com/higgins2`.
- [ ] This REQ moved to `requests/archive/` with a one-line "Completed" header.

---

## Appendix A — Sample team-assembly flows for the rubric

| Task | Expected roster |
|---|---|
| "Omni-channel marketing campaign for Q3 launch" | **Orchestrators:** Dakota (mkt). **Cross-functional:** Kendall (pricing), Skyler (data). **Leaf consulted (inside Dakota):** Harper (brand-voice), Sage (campaign), Avery-M (icp-adapt) |
| "Strategy review — should we sunset Product X?" | **Orchestrators:** Marlowe (fin). **Cross-functional:** Ellis (strategy), Cameron (finance modeling). **Exec:** Alfred (strategic-advisor), Jarvis (chief-of-staff) |
| "Customer complaint escalated — how do we respond?" | **Orchestrators:** Sup orchestrator. **Cross-functional:** Morgan-L (legal). **Leaf consulted:** sup-escalation-handler, sup-quality-reviewer |
| "Help me prep the Q2 board update" | **Orchestrators:** Marlowe (fin), Dakota (mkt). **Cross-functional:** Skyler (data). **Exec:** Jarvis, Alfred |
| "I'm thinking about taking on a new vertical" | **Orchestrators:** Marlowe (fin), Dakota (mkt). **Cross-functional:** Ellis (strategy), Cameron (finance), Jordan-B (partnerships). **Exec:** Alfred |

The pricing example from JB's walkthrough (Decision 1):

> "Higgins, bring the team together to discuss pricing on a new product"
>
> **Orchestrators:** Dakota (mkt), sales-orchestrator (or pm-orchestrator if PRD is needed).
> **Cross-functional:** Kendall (pricing), Morgan-L (legal/compliance), Cameron (finance modeling).
> **Leaf consulted (inside Dakota):** Avery-M (icp-adapt for client profile), Sage (campaign considerations for pricing rollout).

## Appendix B — Tiered catalog injection format (Phase 1)

Higgins's system prompt (appended after the base `exec-orchestrator/SKILL.md` content):

```
## Your team — Department Orchestrators

These are your direct reports. When a task requires multi-disciplinary work,
call `assemble_team` with the relevant slugs from this list.

- mkt-orchestrator — Dakota · Marketing · Campaigns, brand, content, ICP work
- fin-orchestrator — Marlowe · Finance · Budget, reporting, revenue ops, controller
- hr-orchestrator — [name] · HR · Hiring, performance, culture, policy
- ops-orchestrator — [name] · Operations · Process, vendors, SLAs, cost
- pm-orchestrator — [name] · Product · Roadmap, QA, releases, incidents
- sales-orchestrator — [name] · Sales · Pipeline, outreach, deal strategy, proposals
- sup-orchestrator — [name] · Support · Ticketing, knowledge, escalations

## Cross-functional helpers (available to you and any orchestrator)

Inject these directly into your synthesis or pass to a dept orchestrator's brief.

- biz-strategy — Ellis · OKR cascading, initiative prioritization, tactical strategy
- biz-pricing — Kendall · Pricing decisions across any department
- biz-finance — Cameron · Business cases, financial modeling
- biz-legal — Morgan-L · Legal risk, contracts, compliance
- biz-follow-up — Marley · Schedule follow-ups, track triggers
- biz-data — Skyler · Cross-department data analysis
- biz-partnerships — Jordan-B · Partnership evaluation, BD strategy
- biz-customer-success — [name] · Retention signals, churn analysis

## Your exec team

- exec-chief-of-staff — Jarvis · Decision tracking, meeting prep, alignment
- exec-strategic-advisor — Alfred · Market vision, scenario planning, strategic narrative
```

Approximately 16 lines, ~1.5K tokens. The leaf specialists are NOT in Higgins's prompt — they load inside their parent dept orchestrator's prompt at fan-out time.

## Appendix C — Current state inventory

| Component | Status | Location |
|---|---|---|
| Skill registry | Exists, 74 backfilled | `skill_registry` table (REQ-001) |
| Skills public API | Exists | `api/skills.py` |
| Skill `SKILL.md` files | Exists — character names present in frontmatter `description` | `~/Documents/AIDevelopment/.agents/skills/{slug}/SKILL.md` |
| `exec-orchestrator/SKILL.md` | Exists — Higgins's documented persona | `~/Documents/AIDevelopment/.agents/skills/exec-orchestrator/SKILL.md` |
| 6–7 dept orchestrator SKILL.md files | Exists | `~/Documents/AIDevelopment/.agents/skills/{dept}-orchestrator/SKILL.md` |
| 8 cross-functional biz-* SKILL.md files | Exists | `~/Documents/AIDevelopment/.agents/skills/biz-*/SKILL.md` |
| Higgins chat infrastructure | Exists | `api/chat.ts` (REQ-002) |
| Higgins UI shell | Exists | `public/higgins2.html` (REQ-002) |
| Vercel Blob | Wired | `api/lib/blob.ts` (REQ-002 Phase 4) |
| `assemble_team` tool | Does not exist | — (Phase 2) |
| Team assembly modal | Does not exist | — (Phase 3) |
| Avatar defaults | Does not exist | — (Phase 2) |
| Skill content read path from chat | Does not exist | — (Phase 1) |
| Hierarchical fan-out | Does not exist | — (Phase 4) |
| Attribution footer | Does not exist | — (Phase 5) |

### Confirmed character names (from SKILL.md frontmatter, sampled 2026-05-21)

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

Phase 0 backfill script populates the rest from each SKILL.md's frontmatter.
