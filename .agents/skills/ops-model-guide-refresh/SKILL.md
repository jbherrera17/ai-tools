---
name: Model Guide Refresh
description: Checks Anthropic's published model documentation for changes and refreshes the /claude-models page on AI.JBHerrera when the lineup, pricing, or limits move. Run monthly, or whenever a model release is announced.
---

# Model Guide Refresh

Keeps `public/claude-models.html` accurate. The page is a routing card plus decision tree for choosing between current Claude models, and it goes stale the moment Anthropic ships or retires one.

## When to run

- Monthly, as a standing check.
- Immediately after any Claude model announcement.
- Ahead of a known expiry already noted on the page (see **Known expiries** below).

## Source of truth

Primary documentation only. Do not refresh from blog posts, aggregator comparison sites, or model knowledge — several third-party "current lineup" pages carry lineups that are one or two generations out of date, and they read as authoritative.

- Model comparison table and specs: `platform.claude.com/docs/en/about-claude/models/overview`
- Task-to-model guidance: `platform.claude.com/docs/en/about-claude/models/choosing-a-model`
- Pricing: `platform.claude.com/docs/en/about-claude/pricing`

## What to check

For every model listed on the page, and for any model on the docs that the page is missing:

1. Model still current, or moved to legacy
2. Price per million tokens, input and output
3. Context window and max output tokens
4. Comparative latency
5. Reliable knowledge cutoff
6. API model ID
7. Thinking mode — extended vs adaptive, and whether it is always on
8. Limited-availability siblings and the programs gating them

Also re-check the decision tree itself. A new model does not just add a card — it may change which model wins a branch. Read the routing questions against the new lineup before assuming they still hold.

## Procedure

1. Fetch the three source pages above. Note the date.
2. Diff each checked field against `public/claude-models.html`.
3. If nothing changed, update only the verification date in the notes section and stop. Say so plainly rather than manufacturing an edit.
4. If something changed, branch from `main`, update the page, and open a PR. Summarize what moved and what stayed in the PR body.
5. If a model was added or retired, revisit the decision rail and the four model cards together, not just the affected card.

## Constraints

This page lives under the site's design standard. Before editing, read [../../../docs/design-standard.md](../../../docs/design-standard.md).

- No hex literals in page CSS. Per-model accents reuse `--color-secondary`, `--color-primary`, `--color-info`, and `--color-success`. A fifth model needs a token that already exists in `base.css`, or a new token added to both `:root` and `[data-theme="dark"]` there — never an inline color.
- Type-scale classes only. No inline `font-size`.
- Page CSS stays scoped under `body.page-models`.
- If a model is added, the nav and index card do not change — only the page content does. Adding a whole new *page* is a different job: see [../../../docs/add-new-page.md](../../../docs/add-new-page.md).

## Output standard

- Every number on the page traces to primary documentation.
- The notes section carries a verification date, updated on every run including no-change runs.
- Anything with a known end date is flagged on the page so the next run has something to catch.
- Never soften a stale figure into vagueness to avoid an edit. If a number moved, change the number.

## Known expiries

- **Sonnet 5 introductory pricing** ends August 31, 2026. The $3 / $15 standard rate takes effect September 1, 2026. A run in early September must correct this.
- **Claude Mythos 5** availability is gated by Project Glasswing. If that program opens up, the notes section needs rewording.

## History

- 2026-07-25 — page created at `/claude-models`, specs verified against the model overview and choosing-a-model docs the same day.
