# AI.JBHerrera

A multi-tool web app for solo entrepreneurs — AI digest, AI stack education, skills library, Higgins 2.0 prototype, CA bill tracker, and more. Static frontend in `public/`, Python serverless functions in `api/`, deployed on Vercel.

## Quick commands

```bash
npm run dev:start    # Local dev server (http://localhost:3000)
npm run dev:stop     # Gracefully stop dev (SIGINT → SIGKILL escalation; clears port 3000)
npm run dev:restart  # Stop + restart in one shot
vercel --prod        # Deploy to production
pip install -r requirements.txt
```

> `dev:start` (not `dev`) avoids a Vercel CLI gotcha: an npm script literally
> named `dev` makes `vercel dev` recursively invoke itself.

`dev:stop` is the safe way to clean up. `vercel dev` spawns helper workers
(esbuild, runtime sandbox) that can survive a parent kill — `scripts/kill-dev.sh`
finds every PID on port 3000, SIGINTs them, waits 5s, then escalates to SIGKILL.
Always prefer this over `pkill node`.

## Where things live

| If you're doing this | Read this |
|---|---|
| Understanding the codebase | [`docs/architecture.md`](docs/architecture.md) |
| Adding a new UI page | [`docs/add-new-page.md`](docs/add-new-page.md) |
| Authoring a new skill (`.agents/skills/`) | [`docs/skill-folder-format.md`](docs/skill-folder-format.md) |
| Styling a page (tokens, components) | [`docs/design-standard.md`](docs/design-standard.md) |
| Deploying / env vars | [`docs/deployment.md`](docs/deployment.md) |
| First-time setup | [`docs/SETUP.md`](docs/SETUP.md) |

## Hard rules

- Do **not** hardcode colors in page CSS — use the `--color-*` tokens from `public/styles/base.css`.
- Do **not** add a new page without updating the navbar on every existing page and adding an app card to `public/index.html`. See [`docs/add-new-page.md`](docs/add-new-page.md).
- Do **not** commit `.env` or credentials.
- Folders are kebab-case lowercase. Dates are UTC-aware.
- New pages start from `public/_template/page.html`, not by copying a random existing page.

## Retired files

Everything in `archive/` is retired and not part of the build. Don't import from it.
