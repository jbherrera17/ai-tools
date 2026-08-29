import { createClient } from '@supabase/supabase-js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type Args = {
  channel: string;
  outDir: string;
  limit: number;
  syncSupabase: boolean;
  writeEmbeddings: boolean;
  language: string;
};

type Channel = {
  id: string;
  title: string;
  description?: string;
  handle?: string;
  uploadsPlaylistId: string;
};

type Video = {
  id: string;
  title: string;
  description?: string;
  publishedAt?: string;
  url: string;
};

type TranscriptSegment = {
  start: number;
  duration?: number;
  text: string;
};

type TranscriptResult = {
  language: string;
  kind: string;
  segments: TranscriptSegment[];
};

const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';
const WATCH_URL = 'https://www.youtube.com/watch';
const DEFAULT_OUT_DIR = 'data/youtube-transcripts';

async function main() {
  await loadDotEnv('.env.local');
  await loadDotEnv('.env');

  const args = parseArgs(process.argv.slice(2));
  const apiKey = env('YOUTUBE_API_KEY');

  const channel = await resolveChannel(args.channel, apiKey);
  const videos = await listUploads(channel.uploadsPlaylistId, apiKey, args.limit);
  const channelDir = path.join(args.outDir, sanitizeFileName(channel.handle || channel.title || channel.id));
  await mkdir(channelDir, { recursive: true });

  const supabase = args.syncSupabase ? getSupabaseClient() : null;
  const channelRow = supabase ? await upsertChannel(supabase, channel, args.channel) : null;

  let transcriptCount = 0;
  let skippedCount = 0;

  for (const [index, video] of videos.entries()) {
    const prefix = `[${index + 1}/${videos.length}]`;
    console.log(`${prefix} ${video.title}`);

    const transcript = await fetchTranscript(video.id, args.language);
    if (!transcript) {
      skippedCount += 1;
      console.log(`  no public transcript found`);
      if (supabase && channelRow) {
        await upsertVideo(supabase, channelRow.id, video, null, null);
      }
      continue;
    }

    transcriptCount += 1;
    const baseName = `${video.publishedAt?.slice(0, 10) || 'undated'}-${sanitizeFileName(video.title)}-${video.id}`;
    const jsonPath = path.join(channelDir, `${baseName}.json`);
    const mdPath = path.join(channelDir, `${baseName}.md`);
    const chunks = chunkTranscript(transcript.segments);

    await writeFile(jsonPath, `${JSON.stringify({ channel, video, transcript, chunks }, null, 2)}\n`);
    await writeFile(mdPath, renderMarkdown(channel, video, transcript), 'utf8');
    console.log(`  wrote ${path.relative(process.cwd(), mdPath)}`);

    if (supabase && channelRow) {
      const videoRow = await upsertVideo(supabase, channelRow.id, video, transcript, mdPath);
      await replaceSegments(supabase, videoRow.id, transcript.segments);
      await replaceChunks(supabase, videoRow.id, chunks, args.writeEmbeddings);
      console.log(`  synced ${transcript.segments.length} segments and ${chunks.length} chunks`);
    }
  }

  console.log(`Done: ${transcriptCount} transcripts written, ${skippedCount} videos skipped.`);
}

function parseArgs(argv: string[]): Args {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log([
      'Usage: npm run ingest:youtube -- --channel @handle [options]',
      '',
      'Options:',
      '  --channel <handle|id|url>  YouTube channel handle, channel ID, or channel URL',
      '  --out <dir>                Output folder (default: data/youtube-transcripts)',
      '  --limit <number>           Maximum videos to inspect (default: 25)',
      '  --language <code>          Preferred transcript language (default: en)',
      '  --sync-supabase            Write channel/video/transcript rows to Supabase',
      '  --embeddings               Generate embeddings and sync to Supabase',
    ].join('\n'));
    process.exit(0);
  }

  const args: Args = {
    channel: '',
    outDir: DEFAULT_OUT_DIR,
    limit: 25,
    syncSupabase: false,
    writeEmbeddings: false,
    language: 'en',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--channel' && value) {
      args.channel = value;
      i += 1;
    } else if (key === '--out' && value) {
      args.outDir = value;
      i += 1;
    } else if (key === '--limit' && value) {
      args.limit = Number(value);
      i += 1;
    } else if (key === '--language' && value) {
      args.language = value;
      i += 1;
    } else if (key === '--sync-supabase') {
      args.syncSupabase = true;
    } else if (key === '--embeddings') {
      args.writeEmbeddings = true;
      args.syncSupabase = true;
    }
  }

  if (!args.channel) {
    throw new Error('Usage: npm run ingest:youtube -- --channel @handle [--limit 25] [--sync-supabase] [--embeddings]');
  }
  if (!Number.isFinite(args.limit) || args.limit < 1) {
    throw new Error('--limit must be a positive number');
  }
  return args;
}

async function resolveChannel(input: string, apiKey: string): Promise<Channel> {
  const normalized = normalizeChannelInput(input);
  const params = new URLSearchParams({
    part: 'snippet,contentDetails',
    key: apiKey,
  });

  if (normalized.kind === 'id') {
    params.set('id', normalized.value);
  } else {
    params.set('forHandle', normalized.value);
  }

  const data = await youtubeGet<{ items?: any[] }>('channels', params);
  const item = data.items?.[0];
  if (!item) {
    throw new Error(`No YouTube channel found for ${input}`);
  }

  return {
    id: item.id,
    title: item.snippet?.title || item.id,
    description: item.snippet?.description,
    handle: item.snippet?.customUrl,
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads,
  };
}

function normalizeChannelInput(input: string): { kind: 'id' | 'handle'; value: string } {
  const trimmed = input.trim();
  const channelMatch = trimmed.match(/youtube\.com\/channel\/([^/?#]+)/i);
  if (channelMatch) return { kind: 'id', value: channelMatch[1] };
  if (/^UC[\w-]{20,}$/i.test(trimmed)) return { kind: 'id', value: trimmed };

  const handleMatch = trimmed.match(/youtube\.com\/@([^/?#]+)/i);
  const handle = handleMatch?.[1] || trimmed.replace(/^@/, '');
  return { kind: 'handle', value: handle.startsWith('@') ? handle : `@${handle}` };
}

async function listUploads(playlistId: string, apiKey: string, limit: number): Promise<Video[]> {
  const videos: Video[] = [];
  let pageToken: string | undefined;

  while (videos.length < limit) {
    const params = new URLSearchParams({
      part: 'snippet,contentDetails',
      playlistId,
      maxResults: String(Math.min(50, limit - videos.length)),
      key: apiKey,
    });
    if (pageToken) params.set('pageToken', pageToken);

    const data = await youtubeGet<{ items?: any[]; nextPageToken?: string }>('playlistItems', params);
    for (const item of data.items || []) {
      const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
      if (!videoId) continue;
      videos.push({
        id: videoId,
        title: item.snippet?.title || videoId,
        description: item.snippet?.description,
        publishedAt: item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt,
        url: `https://www.youtube.com/watch?v=${videoId}`,
      });
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return videos;
}

async function fetchTranscript(videoId: string, preferredLanguage: string): Promise<TranscriptResult | null> {
  const watch = new URL(WATCH_URL);
  watch.searchParams.set('v', videoId);

  const html = await fetchText(watch.toString());
  const playerResponse = extractPlayerResponse(html);
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!tracks.length) return null;

  const track = chooseTrack(tracks, preferredLanguage);
  if (!track?.baseUrl) return null;

  const transcriptUrl = new URL(track.baseUrl);
  transcriptUrl.searchParams.set('fmt', 'json3');
  const data = await fetchJson<any>(transcriptUrl.toString());
  const segments = (data.events || [])
    .filter((event: any) => Array.isArray(event.segs))
    .map((event: any) => ({
      start: Number(event.tStartMs || 0) / 1000,
      duration: event.dDurationMs ? Number(event.dDurationMs) / 1000 : undefined,
      text: event.segs.map((seg: any) => seg.utf8 || '').join('').replace(/\s+/g, ' ').trim(),
    }))
    .filter((segment: TranscriptSegment) => segment.text);

  return {
    language: track.languageCode || preferredLanguage,
    kind: track.kind || 'manual',
    segments,
  };
}

function extractPlayerResponse(html: string): any | null {
  const marker = 'ytInitialPlayerResponse = ';
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const jsonStart = start + marker.length;
  const jsonEnd = findJsonObjectEnd(html, jsonStart);
  if (jsonEnd === -1) return null;
  return JSON.parse(html.slice(jsonStart, jsonEnd + 1));
}

function findJsonObjectEnd(input: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < input.length; i += 1) {
    const char = input[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') inString = true;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function chooseTrack(tracks: any[], preferredLanguage: string): any {
  return (
    tracks.find((track) => track.languageCode === preferredLanguage && track.kind !== 'asr') ||
    tracks.find((track) => track.languageCode === preferredLanguage) ||
    tracks.find((track) => String(track.languageCode || '').startsWith(preferredLanguage.split('-')[0])) ||
    tracks[0]
  );
}

function chunkTranscript(segments: TranscriptSegment[], maxChars = 2800) {
  const chunks: Array<{ index: number; start: number; end: number; text: string; tokenEstimate: number }> = [];
  let current: TranscriptSegment[] = [];
  let length = 0;

  for (const segment of segments) {
    const nextLength = length + segment.text.length + 1;
    if (current.length && nextLength > maxChars) {
      chunks.push(makeChunk(chunks.length, current));
      current = [];
      length = 0;
    }
    current.push(segment);
    length += segment.text.length + 1;
  }
  if (current.length) chunks.push(makeChunk(chunks.length, current));
  return chunks;
}

function makeChunk(index: number, segments: TranscriptSegment[]) {
  const text = segments.map((segment) => segment.text).join(' ');
  const first = segments[0];
  const last = segments[segments.length - 1];
  return {
    index,
    start: first.start,
    end: last.start + (last.duration || 0),
    text,
    tokenEstimate: Math.ceil(text.length / 4),
  };
}

function renderMarkdown(channel: Channel, video: Video, transcript: TranscriptResult): string {
  const lines = [
    '---',
    `channel_id: ${channel.id}`,
    `channel_title: ${escapeYaml(channel.title)}`,
    `video_id: ${video.id}`,
    `title: ${escapeYaml(video.title)}`,
    `url: ${video.url}`,
    `published_at: ${video.publishedAt || ''}`,
    `transcript_language: ${transcript.language}`,
    `transcript_kind: ${transcript.kind}`,
    '---',
    '',
    `# ${video.title}`,
    '',
    transcript.segments
      .map((segment) => `[${formatTimestamp(segment.start)}] ${segment.text}`)
      .join('\n\n'),
    '',
  ];
  return lines.join('\n');
}

async function upsertChannel(supabase: any, channel: Channel, sourceUrl: string) {
  const { data, error } = await supabase
    .from('youtube_channels')
    .upsert({
      youtube_channel_id: channel.id,
      handle: channel.handle,
      title: channel.title,
      description: channel.description,
      uploads_playlist_id: channel.uploadsPlaylistId,
      source_url: sourceUrl,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'youtube_channel_id' })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

async function upsertVideo(supabase: any, channelId: string, video: Video, transcript: TranscriptResult | null, transcriptPath: string | null) {
  const { data, error } = await supabase
    .from('youtube_videos')
    .upsert({
      youtube_video_id: video.id,
      channel_id: channelId,
      title: video.title,
      description: video.description,
      published_at: video.publishedAt,
      url: video.url,
      transcript_language: transcript?.language || null,
      transcript_kind: transcript?.kind || null,
      transcript_path: transcriptPath,
      transcript_available: Boolean(transcript),
      transcript_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'youtube_video_id' })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

async function replaceSegments(supabase: any, videoId: string, segments: TranscriptSegment[]) {
  await checked(supabase.from('youtube_transcript_segments').delete().eq('video_id', videoId));
  if (!segments.length) return;
  await checked(supabase.from('youtube_transcript_segments').insert(segments.map((segment, index) => ({
    video_id: videoId,
    segment_index: index,
    start_seconds: segment.start,
    duration_seconds: segment.duration,
    text: segment.text,
  }))));
}

async function replaceChunks(supabase: any, videoId: string, chunks: ReturnType<typeof chunkTranscript>, withEmbeddings: boolean) {
  await checked(supabase.from('youtube_transcript_chunks').delete().eq('video_id', videoId));
  if (!chunks.length) return;
  const rows = [];
  for (const chunk of chunks) {
    rows.push({
      video_id: videoId,
      chunk_index: chunk.index,
      start_seconds: chunk.start,
      end_seconds: chunk.end,
      text: chunk.text,
      token_estimate: chunk.tokenEstimate,
      embedding: withEmbeddings ? await embedText(chunk.text) : null,
      metadata: {},
    });
  }
  await checked(supabase.from('youtube_transcript_chunks').insert(rows));
}

async function embedText(text: string): Promise<number[]> {
  const { embed } = await import('ai');
  const { embedding } = await embed({
    model: 'openai/text-embedding-3-small',
    value: text.slice(0, 8000),
  });
  return embedding;
}

async function youtubeGet<T>(resource: string, params: URLSearchParams): Promise<T> {
  return fetchJson<T>(`${YOUTUBE_API}/${resource}?${params.toString()}`);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { 'user-agent': 'ai-tools-youtube-ingest/0.1' } });
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'user-agent': 'ai-tools-youtube-ingest/0.1' } });
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${await response.text()}`);
  }
  return response.text();
}

async function checked(query: PromiseLike<{ error: unknown }>) {
  const { error } = await query;
  if (error) throw error;
}

function getSupabaseClient() {
  const url = env('SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY is required for --sync-supabase');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function loadDotEnv(fileName: string) {
  try {
    const file = await readFile(path.join(process.cwd(), fileName), 'utf8');
    for (const line of file.split(/\r?\n/)) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // Optional local env file.
  }
}

function sanitizeFileName(value: string): string {
  return value
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'untitled';
}

function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  const minutes = Math.floor((totalSeconds / 60) % 60).toString().padStart(2, '0');
  const hours = Math.floor(totalSeconds / 3600);
  return hours ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}

function escapeYaml(value: string): string {
  return JSON.stringify(value);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
