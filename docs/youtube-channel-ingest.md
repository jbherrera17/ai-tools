# YouTube Channel Ingest

This CLI pulls recent videos from a YouTube channel, writes available public transcripts to Markdown and JSON files, and can sync transcript segments/chunks into Supabase for agent retrieval.

## Setup

Add these values to `ai-tools/.env.local`:

```bash
YOUTUBE_API_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Apply the database migration before using `--sync-supabase`:

```bash
supabase db push
```

or run `db/migrations/005_youtube_channel_agent_schema.sql` in the Supabase SQL editor.

## Usage

```bash
npm run ingest:youtube -- --channel @GoogleDevelopers --limit 10
```

Write files and sync rows into Supabase:

```bash
npm run ingest:youtube -- --channel @GoogleDevelopers --limit 10 --sync-supabase
```

Also generate embeddings for `youtube_transcript_chunks.embedding`:

```bash
npm run ingest:youtube -- --channel @GoogleDevelopers --limit 10 --embeddings
```

## Output

Files are written under:

```text
data/youtube-transcripts/<channel>/
```

Each video with a public transcript gets:

- `.md` transcript with YAML front matter and timestamps
- `.json` transcript with channel/video metadata, raw segments, and chunked text

## Notes

The YouTube Data API is used for channel and video metadata. Public captions are pulled from each video page's caption track metadata. Some videos do not expose transcripts, and private/member-only/unlisted videos may not be available.

