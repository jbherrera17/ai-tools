# Adding a new UI page

The standard way to add a page to AI.JBHerrera. Follow every step — skipping the navbar or the index card will leave the page orphaned.

## The 5 steps

### 1. Copy the template

```bash
cp public/_template/page.html public/<slug>.html
```

Then in `<slug>.html`:

- Replace `PAGE TITLE`, `EYEBROW`, `PAGE HEADLINE`, the subhead, and the `<meta description>`.
- Change `body class="page-PAGESLUG"` to a unique class (e.g. `page-bills`).
- In the navbar block, add `class="active"` to the link that matches this new page.
- Leave the Insight 360 chatbot widget snippet at the bottom of `<body>` in place. It is site-wide and every page must carry it.

### 2. Add the link to every other page's navbar

The navbar is duplicated across every `public/*.html`. When you add a page, update the `<div class="navbar-links">` block in:

- `public/index.html`
- `public/digest.html`
- `public/ai-stack.html`
- `public/skills.html`
- `public/higgins2.html`
- `public/ca-bill-tracker.html`
- `public/admin.html` (admin nav is its own variant — match the pattern there)
- `public/_template/page.html` (so future pages inherit the new link)

Use the same order on every page. Current order: `AI Digest`, `AI Stack`, `Skills`, `Higgins 2.0`, `CA Bills`, `Main Site`.

### 3. Add an app card to the index grid

Open `public/index.html`. Inside `<div class="apps-grid">`, add a new card. Pattern:

```html
<a href="/<slug>" class="app-card">
    <div class="app-icon <icon-class>">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <!-- 24x24 icon paths -->
        </svg>
    </div>
    <h3><Page Title></h3>
    <p>One-to-two sentence description of what the tool does and who it's for.</p>
    <div class="app-features">
        <span class="app-feature">Feature 1</span>
        <span class="app-feature">Feature 2</span>
        <span class="app-feature">Feature 3</span>
    </div>
    <span class="app-status live">
        <span class="app-status-dot"></span>
        Live
    </span>
</a>
```

Add a matching icon-class to the `<style>` block in `index.html`:

```css
.app-icon.<icon-class> { background: linear-gradient(135deg, #COLORA, #COLORB); }
```

Status options: `live`, `prototype`, `coming` (use `<div class="app-card coming-soon">` instead of `<a>` for coming-soon).

### 4. Add a route to vercel.json

In `vercel.json`, add a rewrite **before** the catch-all `/` rule:

```json
{ "source": "/<slug>", "destination": "/<slug>.html" }
```

### 5. Verify locally before pushing

```bash
vercel dev
```

Per the engineering pre-flight checklist:

- Open `http://localhost:3000/<slug>` — confirm the page renders, not just HTTP 200.
- Click every nav link from the new page — confirm they all navigate.
- Open the index page — confirm the new app card appears in the grid and clicks through.
- Toggle the theme — confirm dark mode works.
- On at least one other page, confirm the new nav link appears.

## What changes when

- **New shared component** (modal, tooltip, etc.) → add to `base.css`, document in `design-standard.md`. Do not duplicate inline across pages.
- **New color** → add to `:root` and `[data-theme="dark"]` in `base.css`. Never inline a one-off hex in a page.
- **New API endpoint for the page** → add a `.py` file under `api/`, register a rewrite in `vercel.json`. See `architecture.md`.

## Reference implementation

`public/ai-stack.html` is the canonical example of the design standard applied. When the template falls short, mirror that file.
