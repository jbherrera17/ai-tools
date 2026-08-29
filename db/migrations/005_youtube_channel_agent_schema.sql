create extension if not exists vector;

create table if not exists youtube_channels (
  id uuid primary key default gen_random_uuid(),
  youtube_channel_id text not null unique,
  handle text,
  title text not null,
  description text,
  uploads_playlist_id text,
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists youtube_videos (
  id uuid primary key default gen_random_uuid(),
  youtube_video_id text not null unique,
  channel_id uuid not null references youtube_channels(id) on delete cascade,
  title text not null,
  description text,
  published_at timestamptz,
  url text not null,
  transcript_language text,
  transcript_kind text,
  transcript_path text,
  transcript_available boolean not null default false,
  transcript_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists youtube_transcript_segments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references youtube_videos(id) on delete cascade,
  segment_index integer not null,
  start_seconds numeric not null,
  duration_seconds numeric,
  text text not null,
  created_at timestamptz not null default now(),
  unique (video_id, segment_index)
);

create table if not exists youtube_transcript_chunks (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references youtube_videos(id) on delete cascade,
  chunk_index integer not null,
  start_seconds numeric,
  end_seconds numeric,
  text text not null,
  token_estimate integer not null,
  embedding vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (video_id, chunk_index)
);

create index if not exists youtube_videos_channel_id_idx
  on youtube_videos(channel_id);

create index if not exists youtube_transcript_segments_video_id_idx
  on youtube_transcript_segments(video_id);

create index if not exists youtube_transcript_chunks_video_id_idx
  on youtube_transcript_chunks(video_id);

create index if not exists youtube_transcript_chunks_embedding_idx
  on youtube_transcript_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100)
  where embedding is not null;

