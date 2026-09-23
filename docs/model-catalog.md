# Higgins model catalog

The selector and chat request allowlist share `api/lib/modelCatalog.ts`.
Last verified: **September 22, 2026**.

Models must be available in the [Vercel AI Gateway catalog](https://ai-gateway.vercel.sh/v1/models)
as language models with tool use. Vendor API IDs may differ from Gateway IDs;
in particular, Grok now uses the `spacexai/` model prefix. Its BYOK provider
key remains configured separately in `gatewayByok.ts`.

Latest options added in this refresh:

| Vendor | Models | Vendor reference |
| --- | --- | --- |
| Anthropic | Claude Opus 5.5, Claude Fable 5.1 | [Model overview](https://platform.claude.com/docs/en/models/overview) |
| OpenAI | GPT-6 Astra, GPT-6 Sol, GPT-6 Luna | [Models](https://developers.openai.com/api/docs/models) |
| SpaceXAI | Grok 4.7 | [Release notes](https://docs.x.ai/developers/release-notes) |
| Google | Gemini 3.8 Flash, Gemini 3.5 Flash-Lite | [Models](https://ai.google.dev/gemini-api/docs/models) |
| DeepSeek | V4.1 Flash, V4 Pro 0813 | [Change log](https://api-docs.deepseek.com/updates/) |
| Meta | Muse Spark 1.3 | [Announcement](https://research.meta.ai/blog/introducing-muse-spark-1-3) |
| Mistral | Medium 3.5 | [Models](https://docs.mistral.ai/models) |

Existing supported models remain selectable, including Gemma 4 31B and
Llama 4 Maverick. Separate vendor groups avoid classifying all Meta models
as open source. Default chat and department models remain Opus 5 and Sonnet 5;
adding a selector option does not change the default for existing users.

For future updates, verify vendor releases and exact Gateway IDs, check that
each entry supports language output and tool use, run `npm run typecheck`,
and check that catalog IDs are unique, grouped, and include both defaults.
Live inference additionally requires Gateway credentials and provider access.
