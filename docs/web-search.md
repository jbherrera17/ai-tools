# Higgins web search

Higgins can call `web_search` when asked to search or verify information online,
or when answering questions that need current information. Ask, for example:
“Search the web for today's AI announcements and link to the original sources.”
The chat shows “Searching the web…” while an initial search runs. Responses
are instructed to cite retrieved sources as Markdown links; these links are
saved with the answer and remain available after reloading a conversation.

Search uses `gateway.tools.perplexitySearch()` through the existing Vercel AI
Gateway credentials (production OIDC or a local `AI_GATEWAY_API_KEY`). No
separate Perplexity key is required. It is available regardless of which
catalog model is selected. Gateway credits/billing must cover search usage.
See [Vercel's web-search documentation](https://vercel.com/docs/ai-gateway/models-and-providers/web-search).

Defaults request five results, 6,000 total result tokens, and 1,200 tokens per
page. These are search defaults, not hard per-turn spending limits. The chat's
existing eight-step tool-loop limit remains in place. Search results are
treated as untrusted evidence and errors or empty results must be disclosed.

Validation: `npm run typecheck` and `npm run test:web-search`. The tests exercise
SDK search-call/result streaming and persisted answer links with mock results,
empty results, and rate limits. A live smoke test additionally requires Gateway
credentials: ask a current factual question, confirm a search occurs, open a
citation, and reload the conversation to check the answer and link persist.
