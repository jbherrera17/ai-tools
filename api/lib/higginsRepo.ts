import { getServiceClient } from './supabaseClient.js';
import { OWNER_USER_ID } from './auth.js';

/**
 * Higgins 2.0 persistence layer (REQ-002 Phase 1).
 *
 * Thin wrappers over Supabase tables defined in db/higgins_schema.sql.
 * All functions assume the service-role client (RLS bypassed) — v1 is
 * single-user. Add RLS + user-scoped client when multi-user lands.
 */

// ============================================
// Types — mirror the SQL schema
// ============================================

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export type ArtifactType =
  | 'markdown'
  | 'code'
  | 'html'
  | 'table'
  | 'docx'
  | 'pptx'
  | 'remotion-video';

export type MemoryKind =
  | 'summary'
  | 'fact'
  | 'preference'
  | 'project'
  | 'reference';

export type MemoryScope = 'global' | 'conversation' | 'project';

export interface Conversation {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  parts: unknown; // AI SDK v6 UIMessage parts array
  created_at: string;
}

export interface Artifact {
  id: string;
  conversation_id: string;
  slug: string;
  type: ArtifactType;
  title: string | null;
  current_version: number;
  blob_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArtifactVersion {
  id: string;
  artifact_id: string;
  version_no: number;
  content: unknown;
  blob_url: string | null;
  version_note: string | null;
  created_at: string;
}

export interface Memory {
  id: string;
  user_id: string;
  conversation_id: string | null;
  kind: MemoryKind;
  scope: MemoryScope;
  title: string | null;
  content: string;
  source_message_ids: string[] | null;
  importance: number;
  embedding: number[] | null;
  created_at: string;
  expires_at: string | null;
}

// ============================================
// Conversations
// ============================================

export async function createConversation(args: {
  title?: string | null;
  userId?: string;
}): Promise<Conversation> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('higgins_conversations')
    .insert({
      user_id: args.userId ?? OWNER_USER_ID,
      title: args.title ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Conversation;
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('higgins_conversations')
    .select()
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as Conversation) ?? null;
}

export async function listConversations(args: {
  userId?: string;
  limit?: number;
}): Promise<Conversation[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('higgins_conversations')
    .select()
    .eq('user_id', args.userId ?? OWNER_USER_ID)
    .order('updated_at', { ascending: false })
    .limit(args.limit ?? 50);
  if (error) throw error;
  return (data ?? []) as Conversation[];
}

export async function touchConversation(id: string): Promise<void> {
  const sb = getServiceClient();
  const { error } = await sb
    .from('higgins_conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteConversation(id: string): Promise<void> {
  const sb = getServiceClient();
  const { error } = await sb.from('higgins_conversations').delete().eq('id', id);
  if (error) throw error;
}

// ============================================
// Messages
// ============================================

export async function appendMessage(args: {
  conversationId: string;
  role: MessageRole;
  parts: unknown;
}): Promise<Message> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('higgins_messages')
    .insert({
      conversation_id: args.conversationId,
      role: args.role,
      parts: args.parts,
    })
    .select()
    .single();
  if (error) throw error;
  // Bump conversation updated_at so the sidebar surfaces recent activity.
  await touchConversation(args.conversationId);
  return data as Message;
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('higgins_messages')
    .select()
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Message[];
}

// ============================================
// Artifacts
// ============================================

export async function upsertArtifact(args: {
  conversationId: string;
  slug: string;
  type: ArtifactType;
  title?: string | null;
  blobUrl?: string | null;
}): Promise<Artifact> {
  const sb = getServiceClient();
  // Try update first, insert on miss — Supabase upsert needs the unique
  // constraint name; explicit two-step is clearer and avoids 409s.
  const existing = await sb
    .from('higgins_artifacts')
    .select()
    .eq('conversation_id', args.conversationId)
    .eq('slug', args.slug)
    .maybeSingle();
  if (existing.error) throw existing.error;

  if (existing.data) {
    const { data, error } = await sb
      .from('higgins_artifacts')
      .update({
        type: args.type,
        title: args.title ?? (existing.data as Artifact).title,
        blob_url: args.blobUrl ?? (existing.data as Artifact).blob_url,
      })
      .eq('id', (existing.data as Artifact).id)
      .select()
      .single();
    if (error) throw error;
    return data as Artifact;
  }

  const { data, error } = await sb
    .from('higgins_artifacts')
    .insert({
      conversation_id: args.conversationId,
      slug: args.slug,
      type: args.type,
      title: args.title ?? null,
      blob_url: args.blobUrl ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Artifact;
}

export async function appendArtifactVersion(args: {
  artifactId: string;
  content: unknown;
  blobUrl?: string | null;
  versionNote?: string | null;
}): Promise<ArtifactVersion> {
  const sb = getServiceClient();
  const { data: art, error: artErr } = await sb
    .from('higgins_artifacts')
    .select()
    .eq('id', args.artifactId)
    .single();
  if (artErr) throw artErr;
  const nextVersion = (art as Artifact).current_version + 1;

  const { data, error } = await sb
    .from('higgins_artifact_versions')
    .insert({
      artifact_id: args.artifactId,
      version_no: nextVersion,
      content: args.content,
      blob_url: args.blobUrl ?? null,
      version_note: args.versionNote ?? null,
    })
    .select()
    .single();
  if (error) throw error;

  const { error: bumpErr } = await sb
    .from('higgins_artifacts')
    .update({
      current_version: nextVersion,
      blob_url: args.blobUrl ?? (art as Artifact).blob_url,
    })
    .eq('id', args.artifactId);
  if (bumpErr) throw bumpErr;

  return data as ArtifactVersion;
}

export async function listArtifacts(conversationId: string): Promise<Artifact[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('higgins_artifacts')
    .select()
    .eq('conversation_id', conversationId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Artifact[];
}

export async function listArtifactVersions(
  artifactId: string,
): Promise<ArtifactVersion[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('higgins_artifact_versions')
    .select()
    .eq('artifact_id', artifactId)
    .order('version_no', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ArtifactVersion[];
}

// ============================================
// Memories (Phase 1 = persistence only; Phase 5 wires recall + embeddings)
// ============================================

export async function saveMemory(args: {
  kind: MemoryKind;
  content: string;
  title?: string | null;
  scope?: MemoryScope;
  conversationId?: string | null;
  sourceMessageIds?: string[] | null;
  importance?: number;
  userId?: string;
  embedding?: number[] | null;
}): Promise<Memory> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('higgins_memories')
    .insert({
      user_id: args.userId ?? OWNER_USER_ID,
      conversation_id: args.conversationId ?? null,
      kind: args.kind,
      scope: args.scope ?? 'global',
      title: args.title ?? null,
      content: args.content,
      source_message_ids: args.sourceMessageIds ?? null,
      importance: args.importance ?? 3,
      embedding: args.embedding ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Memory;
}

/**
 * Semantic recall via pgvector. Requires the `match_higgins_memories`
 * Postgres function (see db/higgins_schema.sql Phase 5 additions).
 */
export interface RecalledMemory {
  id: string;
  kind: MemoryKind;
  scope: MemoryScope;
  title: string | null;
  content: string;
  importance: number;
  similarity: number;
  created_at: string;
}

export async function recallMemories(args: {
  queryEmbedding: number[];
  userId?: string;
  matchCount?: number;
  kind?: MemoryKind;
  scope?: MemoryScope;
}): Promise<RecalledMemory[]> {
  const sb = getServiceClient();
  const { data, error } = await sb.rpc('match_higgins_memories', {
    query_embedding: args.queryEmbedding,
    user_filter: args.userId ?? OWNER_USER_ID,
    match_count: args.matchCount ?? 5,
    kind_filter: args.kind ?? null,
    scope_filter: args.scope ?? null,
  });
  if (error) throw error;
  return (data ?? []) as RecalledMemory[];
}

export async function getMemory(id: string): Promise<Memory | null> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('higgins_memories')
    .select()
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as Memory) ?? null;
}

export async function listMemories(args: {
  userId?: string;
  kind?: MemoryKind;
  conversationId?: string;
  limit?: number;
}): Promise<Memory[]> {
  const sb = getServiceClient();
  let q = sb
    .from('higgins_memories')
    .select()
    .eq('user_id', args.userId ?? OWNER_USER_ID)
    .order('importance', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(args.limit ?? 100);
  if (args.kind) q = q.eq('kind', args.kind);
  if (args.conversationId) q = q.eq('conversation_id', args.conversationId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Memory[];
}

export async function forgetMemory(id: string): Promise<void> {
  const sb = getServiceClient();
  const { error } = await sb.from('higgins_memories').delete().eq('id', id);
  if (error) throw error;
}

// ============================================
// Team sessions — REQ-004 Phase 2
// ============================================

export interface RosterEntry {
  slug: string;
  display_name: string | null;
}

export interface TeamRoster {
  orchestrators: RosterEntry[];
  cross_functional: RosterEntry[];
  exec_team: RosterEntry[];
}

export interface TeamSession {
  id: string;
  conversation_id: string;
  roster: TeamRoster;
  task_summary: string | null;
  assembled_at: string;
  approved_at: string | null;
}

export async function createTeamSession(args: {
  conversationId: string;
  roster: TeamRoster;
  taskSummary?: string | null;
}): Promise<TeamSession> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('higgins_team_sessions')
    .insert({
      conversation_id: args.conversationId,
      roster: args.roster,
      task_summary: args.taskSummary ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as TeamSession;
}

export async function getTeamSession(id: string): Promise<TeamSession | null> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('higgins_team_sessions')
    .select()
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as TeamSession) ?? null;
}

/** Active = the most recent approved roster for a conversation. */
export async function getActiveTeamSession(
  conversationId: string,
): Promise<TeamSession | null> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('higgins_team_sessions')
    .select()
    .eq('conversation_id', conversationId)
    .not('approved_at', 'is', null)
    .order('approved_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as TeamSession) ?? null;
}

export async function approveTeamSession(id: string): Promise<TeamSession> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('higgins_team_sessions')
    .update({ approved_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as TeamSession;
}

export async function replaceTeamRoster(
  id: string,
  roster: TeamRoster,
): Promise<TeamSession> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('higgins_team_sessions')
    .update({ roster })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as TeamSession;
}
