# AI Readiness Assessment on ai.jbherrera.com — Technical Guide

Status: **design doc, not yet implemented.** Nothing described here exists in either repo yet. This is the plan to review before building.

## What this is

Port Synergi AI's "Higgins" AI Readiness Assessment (currently only on `synergiai.io/ai-readiness.html`) to a new page on `ai.jbherrera.com`, and add a capability the original site doesn't have: uploading a previously downloaded assessment PDF to restore the full interactive report instead of retaking the 18 questions.

Two decisions anchor everything below:

1. **Shared backend.** This page does not run its own copy of the assessment logic. It calls synergi-website's existing `/api/assessment-chat`, `/api/assessment-score`, and `/api/assessment-report` endpoints directly from the browser, cross-origin. The question script, scoring rubric, and pricing catalog stay in exactly one place (`synergi-website/lib/assessment/`). This repo never duplicates them.
2. **Exact restore via embedded data.** synergi-website's printed report gets a small addition: a hidden-but-real machine-readable copy of the full report, printed as tiny text at the end of the PDF. Uploading that PDF later extracts the payload and restores the report exactly — same scores, same findings, same suggested-project pricing — rather than asking a model to re-read prose and guess at numbers.

## Two-repo dependency

This feature spans two separate git repositories and two separate Vercel projects:

| Repo | Role |
|---|---|
| `synergi-website` (`synergiai.io`) | Owns the assessment API, the scoring model calls, the pricing catalog, lead capture to Notion. Must ship the changes in [Part 1](#part-1-required-changes-in-synergi-website-do-this-first) before this page can work. |
| `ai-tools` (`ai.jbherrera.com`, this repo) | New page + new import endpoint. Presentation only — it renders data the other repo produces. |

**Part 1 must ship first.** Nothing in this repo can be tested end-to-end against production until synergi-website's CORS and print-embed changes are live (a synergi-website preview deployment is enough for local dev against this page).

---

## Part 1 — Required changes in synergi-website (do this first)

These are described here because they're the dependency this whole feature rests on, but they are implemented and reviewed in the `synergi-website` repo, not this one.

### 1.1 CORS

`lib/assessment/guard.js`'s `assertOrigin()` currently allows only `https://synergiai.io`, `https://www.synergiai.io`, any `*.vercel.app` preview, and local dev. A browser `fetch()` from `ai.jbherrera.com` will be rejected outright. Required:

- Add `https://ai.jbherrera.com` to `ALLOWED_ORIGINS` in `guard.js`.
- All three endpoints (`api/assessment-chat.js`, `api/assessment-score.js`, `api/assessment-report.js`) need to actually send CORS response headers — today they don't, because every existing caller is same-origin and doesn't need them:
  - `Access-Control-Allow-Origin: <the validated request origin>` (reflect, don't wildcard — the origin allowlist is already the source of truth for who's allowed)
  - `Access-Control-Allow-Methods: POST, OPTIONS`
  - `Access-Control-Allow-Headers: Content-Type`
- All three endpoints need to handle `OPTIONS` (preflight). They currently do `if (req.method !== 'POST') return 405`, which would 405 a preflight request and break CORS before the real POST ever fires. `POST` with `Content-Type: application/json` is not a CORS-simple request, so the browser will preflight every call including the streaming chat endpoint.
- No credentials (cookies, auth headers) are involved anywhere in this flow, so `Access-Control-Allow-Credentials` is not needed — keep the CORS surface as small as possible.

### 1.2 Lead attribution (recommended, small)

`api/assessment-report.js` hardcodes `Source: { select: { name: 'ai-readiness-assessment' } }` when writing a lead to Notion. Once `ai.jbherrera.com` can generate leads too, JB will want to tell them apart. Recommended: accept an optional `source` field in the `POST /api/assessment-report` body (default `'ai-readiness-assessment'` for backward compatibility with the existing site), and pass it through to the Notion write. The new page then sends `source: 'ai-readiness-assessment-ai-tools'`.

### 1.3 Print-embedded report payload

At the point `js/assessment.js`'s `renderDetail()` has the full unlocked report, add one more `.ha-print-only` block at the very end of the printed output (after the existing `.ha-print-cta` paragraph) containing a compact, machine-readable copy of the entire report. Concretely:

- **Format:** two sentinel lines wrapping a base64 blob:
  ```
  ===HA-REPORT-DATA-V1-START===
  <base64 JSON, wrapped at ~80 chars/line for print layout>
  ===HA-REPORT-DATA-V1-END===
  ```
- **Payload contents** (JSON before encoding):
  ```json
  {
    "schemaVersion": 1,
    "generatedAt": "2026-08-24T00:00:00.000Z",
    "company": "Acme Co",
    "overall": 67,
    "stage": { "number": 3, "name": "Focused" },
    "headline": "...",
    "axes": [ /* same shape as publicSlice+fullSlice merged: key, label, score, verdict, subscores, findings, recommendations */ ],
    "prioritySequence": [ /* same shape fullSlice() returns */ ],
    "upskilling": { "philosophy": "...", "tracks": [...] },
    "suggestedProjects": [ /* same shape fullSlice() returns, pricing already resolved at generation time */ ]
  }
  ```
  This is exactly the union of `state.result` (the public slice already held client-side) and the `report` object `renderDetail()` receives, plus `company`/`generatedAt`/`schemaVersion`. No new server call needed — assemble it client-side from data already in memory at that point in the flow.
- **Why base64, not raw JSON:** PDF text extraction reflows text into lines with unpredictable whitespace. Base64's alphabet contains no whitespace, so the extraction side can safely strip all whitespace between the two markers before decoding, regardless of how the PDF wrapped it.
- **Why plain base64, not encrypted:** the same data is already printed in plain, readable text elsewhere on the report (findings, recommendations, company name, email is not included). There's no confidentiality gain from encrypting a second copy of information that's already on the page — the `sealed`/AES mechanism exists for a different reason (a short-lived bearer token gating the *first* unlock) and doesn't apply here. Keeping this plain avoids a second copy of `ASSESSMENT_SECRET` this repo would otherwise need.
- **Styling:** small, muted text (e.g. 6–7pt, light gray, monospace), with one human-readable line above it: *"Machine-readable copy of this report. If you re-upload this PDF, this is what restores your results — please don't edit it."* Transparency matters more than invisibility here; nothing about this should read as hidden tracking.
- **Versioning:** `schemaVersion` lets the import side reject or gracefully degrade on a payload shape it doesn't recognize, if the report schema changes later (e.g. the upskilling/suggested-projects fields added in the current build, or whatever comes after). Bump the version any time a field is added, removed, or renamed in the embedded payload — not for every unrelated site change.

---

## Part 2 — New page in ai-tools

### 2.1 Routing and scaffolding

Follow `docs/add-new-page.md` exactly — all 5 steps (navbar on every page, index app card, `vercel.json` rewrite, local verification). New files:

- `public/ai-readiness.html` — started from `public/_template/page.html`, styled with `public/styles/base.css` tokens (per `docs/design-standard.md`), not synergi-website's CSS. `public/ai-stack.html` is the reference implementation to mirror per `add-new-page.md`.
- `public/scripts/ai-readiness.js` — the page's client controller (see 2.2 and 2.3).
- `api/assessment-import.ts` — the new PDF-import endpoint (see 2.4).
- Nav label: **"AI Readiness"**, added to every page's navbar and to the app grid on `index.html`, consistent with the existing `AI Digest` / `AI Stack` / `Skills` / `Higgins 2.0` / `CA Bills` set.
- Route: `/ai-readiness` → `/ai-readiness.html` in `vercel.json`.

This page is **public**, like AI Digest / AI Stack / Skills / CA Bill Tracker — not gated behind `HIGGINS_API_TOKEN` the way Higgins 2.0 is. It's the same lead-generation tool synergi-website already runs unauthenticated.

### 2.2 Path A — take the assessment fresh

This is a port of `synergi-website/js/assessment.js`'s conversational flow, not a rewrite from first principles: same state machine (`state.messages`, `state.questionIndex`, `state.sealed`, `state.result`), same SSE envelope reader (`readStream()`), same 18-question progress UI. What changes:

- Every `fetch('/api/assessment-...')` call becomes an absolute cross-origin call: `fetch('https://synergiai.io/api/assessment-chat', ...)`. Keep the base URL (`https://synergiai.io`) as a single named constant at the top of `ai-readiness.js` so a synergi-website preview URL can be swapped in for local testing without hunting through the file.
- All HTML/CSS class names and markup are ai-tools' own — reuse `base.css` components and tokens, don't import synergi-website's `assessment.css`. The DOM structure (`data-*` hooks, not `data-ha` specifically) can mirror the original's shape since the JS logic is being ported, but the visual language must match this site.
- The radar SVG drawing function (`drawRadar()`) and the report/card rendering functions port over close to verbatim — they're pure functions of the score data, not tied to synergi-website's markup beyond CSS class names.
- The gate form (email + company) posts to `https://synergiai.io/api/assessment-report` with `source: 'ai-readiness-assessment-ai-tools'` (see 1.2) — leads generated here land in the exact same Notion database as synergi-website leads, distinguishable by source.
- Skip synergi-website's `window.print()` PDF flow entirely for the *fresh assessment* path here — printing isn't this page's job (though nothing stops it from reusing the same approach later if wanted; not required for v1).

### 2.3 Path B — upload a previous report

New capability, not present on synergi-website:

1. A file input (`accept="application/pdf"`) on the page, alongside — not instead of — the "Start the assessment" entry point.
2. On selection, read the file as a base64 string client-side (`FileReader`) and `POST` it as JSON to this repo's own `/api/assessment-import` (same-origin — no CORS concerns, this endpoint lives in `ai-tools`).
3. `assessment-import.ts` extracts and validates the embedded payload (2.4) and returns the reconstructed report JSON.
4. The frontend renders it through **the same rendering functions used in Path A** (`renderReport()`/`renderDetail()`-equivalents), just skipping straight to the fully-unlocked report — no gate, no email prompt, since possessing the PDF already proves they earned the full report once. There is exactly one renderer in this codebase for "a scored report object → HTML"; it must not care whether the object came from a live `/api/assessment-score` response or an imported PDF payload. Keeping this single-path is the main defense against the two flows silently drifting apart.

### 2.4 `api/assessment-import.ts`

```
POST /api/assessment-import
  { filename: string, dataBase64: string }   // whole PDF file, base64-encoded
  -> { report: {...} }                        // same shape the renderer expects
  -> 422 { error, code: 'no-payload' }         // no markers found (pre-feature PDF, or wrong file)
  -> 422 { error, code: 'unsupported-version' } // schemaVersion the import side doesn't know
  -> 400 { error, code: 'malformed' }          // markers found but base64/JSON decode failed
```

Implementation notes:

- Add `pdf-parse` (thin wrapper around `pdfjs-dist`, text-extraction only — that's all this needs) as a new dependency in `package.json`. No other new infra.
- Accept the upload as base64 JSON rather than `multipart/form-data`. `@vercel/node`'s default body parser already handles JSON bodies (same pattern every other TS endpoint in `api/` uses); adding a multipart parser is unnecessary complexity for a single-file upload. A typical report PDF is well under 1MB; base64 inflates that by ~33%, still comfortably inside Vercel's request body limit.
- Reject the upload before parsing if the decoded buffer exceeds a hard cap (e.g. 8MB) — cheap protection against someone uploading an unrelated large file.
- Extract text with `pdf-parse`, then **strip all whitespace from the entire extracted text first**, and only then search for `===HA-REPORT-DATA-V1-START===…===HA-REPORT-DATA-V1-END===`. Stripping whitespace from just the base64 body and not the markers themselves was the first design here and it's wrong — verified against a synthetic "PDF reflow" test that inserted line breaks at arbitrary points (not just at word/line boundaries): a marker can itself get split across a print line break, and a literal string match on `===HA-REPORT-DATA-V1-START===` then silently fails to find real, valid data. Stripping whitespace from the whole text first, before the regex ever runs, makes matching immune to where the PDF happened to wrap lines. (There's no risk of this accidentally merging unrelated prose into a false marker match — the marker is a distinctive 30-character uppercase token that doesn't occur naturally.) Once matched, base64-decode the captured group and `JSON.parse` it. Any failure at any of these steps is a `malformed` response, not a 500 — this is expected-to-sometimes-fail user input (edited PDFs, unrelated PDFs, PDFs from before this feature existed), not a server bug.
- Validate `schemaVersion` against a small allowlist of versions this endpoint knows how to render; reject anything else with `unsupported-version` rather than guessing at an unfamiliar shape.
- No auth needed — same posture as synergi-website's assessment endpoints (public, unauthenticated, cost-bounded by the fact that this one makes zero model calls at all, just text extraction).
- **Stateless.** Nothing is written to Supabase or anywhere else. The imported report lives only in the browser tab that uploaded it, same as a freshly-scored report does today. If JB later wants "log that someone re-engaged via an old PDF," that's a deliberate follow-up, not part of this design — don't build speculative persistence now.

---

## Environment / dependencies

New in `ai-tools`:

| Addition | Purpose |
|---|---|
| `pdf-parse` (npm dep) | Text extraction in `api/assessment-import.ts` |
| Constant `SYNERGI_API_BASE = 'https://synergiai.io'` in `public/scripts/ai-readiness.js` | Not an env var — this is a public client-side fetch target, hardcoded with a comment for how to point it at a synergi-website preview URL during local development |

Nothing new required in `.env`/`.env.example` for this feature — no new secrets, no new Supabase tables, no new tokens.

## Known drift risk

The rendering logic (radar SVG, area cards, upskilling/suggested-project card layout) now exists in two repos: `synergi-website/js/assessment.js` and `ai-tools/public/scripts/ai-readiness.js`. They must stay in sync with the *shape* of data `lib/assessment/scoring.js` in synergi-website produces (whatever `publicSlice()`/`fullSlice()` return), even though their markup/CSS differ. When that shape changes in synergi-website:

1. Bump `schemaVersion` in the print-embed payload (Part 1.3) if the change affects what's embedded.
2. Update `ai-readiness.js`'s renderer to match the new fields.
3. There's no automated check for this — it's a manual "if you touch `lib/assessment/schema.js` or `scoring.js`, check `ai-tools/public/scripts/ai-readiness.js`" discipline, worth a one-line note in synergi-website's `CLAUDE.md` once this ships.

## Rollout sequencing

1. Ship Part 1 in `synergi-website` (CORS, source attribution, print-embed) — verify the printed PDF actually contains a valid, extractable payload before starting Part 2.
2. Build `api/assessment-import.ts` in this repo and test it against a real PDF produced by step 1 (a synergi-website preview deployment is sufficient — the print-embed change doesn't require production).
3. Build the page and the fresh-assessment path, pointed at the synergi-website preview URL.
4. Flip `SYNERGI_API_BASE` to production, confirm `https://ai.jbherrera.com` is in synergi-website's `ALLOWED_ORIGINS` in production, deploy both sides, verify end-to-end on the live URLs.

## Verification checklist

Per this repo's own pre-flight standard (`docs/deployment.md`) plus what's specific to this feature:

- [ ] `/ai-readiness` loads, nav link present and active on every page, app card present on `index.html`.
- [ ] Fresh assessment: complete all 18 questions against the synergi-website preview/prod API, confirm streaming replies render, confirm the score/report renders, confirm the email gate unlocks the full report.
- [ ] Lead lands in the same Notion database as synergi-website leads, with `source` correctly distinguishing it.
- [ ] Upload path: take an assessment on synergi-website, download its PDF, upload that exact file here — confirm the restored report matches the original pixel-for-pixel in content (scores, findings, suggested projects, pricing).
- [ ] Upload a PDF generated *before* the print-embed change — confirm a clear "couldn't find assessment data" error, not a crash.
- [ ] Upload an unrelated PDF — same clear error, not a crash.
- [ ] Upload a >8MB file — rejected before parsing, clear error.
- [ ] Dark mode renders correctly on the new page (per this repo's design standard).
- [ ] Confirm CORS actually works from the deployed `ai.jbherrera.com` origin, not just `localhost` (preflight failures often only show up cross-domain, not in same-machine dev).
