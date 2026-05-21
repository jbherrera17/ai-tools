"""Supabase client initialization for AIDigest."""

import os
import re
from supabase import create_client, Client

# Initialize Supabase client
# Set these in Vercel environment variables or .env file
SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_ANON_KEY = os.environ.get('SUPABASE_ANON_KEY', '')
# Vercel's Supabase integration provisions SUPABASE_SERVICE_ROLE_KEY;
# fall back to SUPABASE_SERVICE_KEY for local dev / older configs.
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_SERVICE_KEY', '')


def get_supabase_client(use_service_key=False) -> Client:
    """
    Get Supabase client.

    Args:
        use_service_key: If True, use service key for admin operations (bypasses RLS).
                        If False, use anon key (respects RLS policies).
    """
    if not SUPABASE_URL:
        raise ValueError("SUPABASE_URL environment variable not set")

    key = SUPABASE_SERVICE_KEY if use_service_key else SUPABASE_ANON_KEY
    if not key:
        key_type = "SUPABASE_SERVICE_KEY" if use_service_key else "SUPABASE_ANON_KEY"
        raise ValueError(f"{key_type} environment variable not set")

    return create_client(SUPABASE_URL, key)


def get_admin_client() -> Client:
    """Get Supabase client with service key for admin operations."""
    return get_supabase_client(use_service_key=True)


def get_public_client() -> Client:
    """Get Supabase client with anon key for public operations."""
    return get_supabase_client(use_service_key=False)


# ============================================
# Feed Operations
# ============================================

def get_active_feeds():
    """Get all active feeds from database."""
    client = get_public_client()
    response = client.table('feeds').select('*').eq('is_active', True).execute()
    return response.data


def get_all_feeds():
    """Get all feeds (including inactive) for admin."""
    client = get_admin_client()
    response = client.table('feeds').select('*').order('category', desc=False).order('name', desc=False).execute()
    return response.data


def get_feed_by_id(feed_id: str):
    """Get a single feed by ID."""
    client = get_admin_client()
    response = client.table('feeds').select('*').eq('id', feed_id).single().execute()
    return response.data


def create_feed(feed_data: dict):
    """Create a new feed."""
    client = get_admin_client()
    response = client.table('feeds').insert(feed_data).execute()
    return response.data[0] if response.data else None


def update_feed(feed_id: str, feed_data: dict):
    """Update an existing feed."""
    client = get_admin_client()
    response = client.table('feeds').update(feed_data).eq('id', feed_id).execute()
    return response.data[0] if response.data else None


def delete_feed(feed_id: str):
    """Delete a feed."""
    client = get_admin_client()
    response = client.table('feeds').delete().eq('id', feed_id).execute()
    return response.data


def toggle_feed_active(feed_id: str, is_active: bool):
    """Toggle feed active status."""
    return update_feed(feed_id, {'is_active': is_active})


# ============================================
# Category Operations
# ============================================

def get_all_categories():
    """Get all categories."""
    client = get_public_client()
    response = client.table('categories').select('*').order('display_order', desc=False).execute()
    return response.data


def create_category(category_data: dict):
    """Create a new category."""
    client = get_admin_client()
    response = client.table('categories').insert(category_data).execute()
    return response.data[0] if response.data else None


def update_category(category_id: str, category_data: dict):
    """Update a category."""
    client = get_admin_client()
    response = client.table('categories').update(category_data).eq('id', category_id).execute()
    return response.data[0] if response.data else None


def delete_category(category_id: str):
    """Delete a category."""
    client = get_admin_client()
    response = client.table('categories').delete().eq('id', category_id).execute()
    return response.data


# ============================================
# ICP Profile Operations
# ============================================

def get_active_icp_profiles():
    """Get all active ICP profiles."""
    client = get_public_client()
    response = client.table('icp_profiles').select('*').eq('is_active', True).execute()
    return response.data


def get_all_icp_profiles():
    """Get all ICP profiles for admin."""
    client = get_admin_client()
    response = client.table('icp_profiles').select('*').order('name', desc=False).execute()
    return response.data


def get_default_icp_profile():
    """Get the default ICP profile."""
    client = get_public_client()
    response = client.table('icp_profiles').select('*').eq('is_default', True).single().execute()
    return response.data


def get_icp_profile_by_id(profile_id: str):
    """Get a single ICP profile by ID."""
    client = get_admin_client()
    response = client.table('icp_profiles').select('*').eq('id', profile_id).single().execute()
    return response.data


def create_icp_profile(profile_data: dict):
    """Create a new ICP profile."""
    client = get_admin_client()
    # If setting as default, unset other defaults first
    if profile_data.get('is_default'):
        client.table('icp_profiles').update({'is_default': False}).eq('is_default', True).execute()
    response = client.table('icp_profiles').insert(profile_data).execute()
    return response.data[0] if response.data else None


def update_icp_profile(profile_id: str, profile_data: dict):
    """Update an ICP profile."""
    client = get_admin_client()
    # If setting as default, unset other defaults first
    if profile_data.get('is_default'):
        client.table('icp_profiles').update({'is_default': False}).neq('id', profile_id).eq('is_default', True).execute()
    response = client.table('icp_profiles').update(profile_data).eq('id', profile_id).execute()
    return response.data[0] if response.data else None


def delete_icp_profile(profile_id: str):
    """Delete an ICP profile."""
    client = get_admin_client()
    response = client.table('icp_profiles').delete().eq('id', profile_id).execute()
    return response.data


def set_default_icp_profile(profile_id: str):
    """Set an ICP profile as the default."""
    client = get_admin_client()
    # Unset all defaults
    client.table('icp_profiles').update({'is_default': False}).eq('is_default', True).execute()
    # Set new default
    response = client.table('icp_profiles').update({'is_default': True}).eq('id', profile_id).execute()
    return response.data[0] if response.data else None


# ============================================
# Feed Suggestions (Discovery)
# ============================================

def get_feed_suggestions(tags: list = None, limit: int = 20):
    """Get feed suggestions, optionally filtered by tags."""
    client = get_public_client()
    query = client.table('feed_suggestions').select('*').order('popularity_score', desc=True).limit(limit)

    if tags:
        # Filter by any matching tag
        query = query.contains('relevance_tags', tags)

    response = query.execute()
    return response.data


def search_feed_suggestions(search_term: str, limit: int = 20):
    """Search feed suggestions by name or description."""
    client = get_public_client()
    response = client.table('feed_suggestions').select('*').or_(
        f"name.ilike.%{search_term}%,description.ilike.%{search_term}%"
    ).order('popularity_score', desc=True).limit(limit).execute()
    return response.data


# ============================================
# Admin Settings
# ============================================

def get_setting(key: str):
    """Get a setting value."""
    client = get_public_client()
    response = client.table('admin_settings').select('value').eq('key', key).single().execute()
    return response.data['value'] if response.data else None


def update_setting(key: str, value):
    """Update a setting value."""
    client = get_admin_client()
    response = client.table('admin_settings').upsert({
        'key': key,
        'value': value
    }).execute()
    return response.data[0] if response.data else None


def get_all_settings():
    """Get all settings as a dict."""
    client = get_public_client()
    response = client.table('admin_settings').select('*').execute()
    return {item['key']: item['value'] for item in response.data}


# ============================================
# Skills Registry Operations (v2 — REQ-001 schema)
# ============================================
#
# Schema model:
#   skill_sources   — one row per origin (Synergi core, PM-skills fork, …)
#   skill_registry  — one row per skill (canonical metadata)
#   skill_versions  — one row per (skill, version) with review lifecycle
#   skill_matches   — candidate→matched pairs from the matching engine
#   skill_adoptions — log of adopted skills
#
# UI backward-compat: get_all_skills() and get_skill_stats() return
# legacy aliases (is_core_skill, is_expert_skill, core_skills, expert_skills)
# alongside the new fields so /skills.html keeps working until Phase 3.

# Map source_type values (new) to the legacy is_core/is_expert booleans (old)
_LEGACY_CORE_TYPES = {'synergi-original'}


def _add_legacy_skill_aliases(skill):
    """Decorate a registry row with the deprecated is_core_skill / is_expert_skill flags."""
    if not skill:
        return skill
    is_core = skill.get('source_type') in _LEGACY_CORE_TYPES
    skill['is_core_skill'] = is_core
    skill['is_expert_skill'] = not is_core
    return skill


def get_all_skills(filters=None):
    """Get all skills from registry, optionally filtered. Adds legacy aliases for UI compat."""
    client = get_public_client()
    query = client.table('skill_registry').select('*').order('department').order('name')

    if filters:
        if filters.get('department'):
            query = query.eq('department', filters['department'])
        if filters.get('source_type'):
            query = query.eq('source_type', filters['source_type'])
        if filters.get('scope'):
            query = query.eq('scope', filters['scope'])
        # Legacy 'type' filter — translate to source_type
        if filters.get('type') == 'core':
            query = query.eq('source_type', 'synergi-original')
        elif filters.get('type') == 'expert':
            query = query.neq('source_type', 'synergi-original')
        if filters.get('source'):
            query = query.eq('source_id', filters['source'])
        if filters.get('search'):
            term = filters['search']
            query = query.or_(f"name.ilike.%{term}%,description.ilike.%{term}%,slug.ilike.%{term}%")

    response = query.execute()
    return [_add_legacy_skill_aliases(s) for s in response.data]


def get_skill_sources():
    """Get all skill sources."""
    client = get_public_client()
    response = client.table('skill_sources').select('*').order('name').execute()
    return response.data


def get_skill_matches(status=None):
    """Get skill matches, optionally filtered by review status."""
    client = get_public_client()
    query = client.table('skill_matches').select(
        '*, candidate:candidate_skill_id(*), matched:matched_skill_id(*)'
    ).order('confidence', desc=True)

    if status:
        query = query.eq('review_status', status)

    response = query.execute()
    return response.data


def get_unmatched_expert_skills():
    """Get non-Synergi skills with no approved match or adoption record."""
    client = get_public_client()
    all_external = client.table('skill_registry').select('*').neq('source_type', 'synergi-original').order('name').execute()
    adopted = client.table('skill_adoptions').select('skill_id').execute()
    adopted_ids = {a['skill_id'] for a in adopted.data if a.get('skill_id')}
    matched = client.table('skill_matches').select('candidate_skill_id').eq('review_status', 'approved').execute()
    matched_ids = {m['candidate_skill_id'] for m in matched.data if m.get('candidate_skill_id')}

    excluded = adopted_ids | matched_ids
    return [_add_legacy_skill_aliases(s) for s in all_external.data if s['id'] not in excluded]


def get_skill_stats():
    """Get dashboard stats for skills registry. Reads from v2 views, plus
    category counts and dependency count for the curator surface."""
    client = get_public_client()

    skill_stats = client.table('skill_stats').select('*').execute()
    s = skill_stats.data[0] if skill_stats.data else {}

    version_stats = client.table('skill_version_stats').select('*').execute()
    v = version_stats.data[0] if version_stats.data else {}

    match_stats = client.table('skill_match_stats').select('*').execute()
    m = match_stats.data[0] if match_stats.data else {}

    adoptions = client.table('skill_adoptions').select('id', count='exact').execute()
    adoption_count = adoptions.count if adoptions.count is not None else len(adoptions.data)

    deps = client.table('skill_dependencies').select('id', count='exact').execute()
    deps_count = deps.count if deps.count is not None else len(deps.data)

    # Category split — distinguishes skills (with SKILL.md) from
    # context-references (the *-shared markdown files registered for governance).
    cats = client.table('skill_registry').select('category').execute()
    skill_entries = sum(1 for r in cats.data if r.get('category') == 'skill')
    context_entries = sum(1 for r in cats.data if r.get('category') == 'context-reference')

    synergi = s.get('synergi_skills', 0) or 0
    anthropic = s.get('anthropic_skills', 0) or 0
    opensource = s.get('opensource_skills', 0) or 0

    return {
        # Corpus
        'total_skills': s.get('total_skills', 0) or 0,
        'skill_entries': skill_entries,
        'context_entries': context_entries,
        'departments': s.get('departments', 0) or 0,
        # Source-type breakdown
        'synergi_skills': synergi,
        'anthropic_skills': anthropic,
        'opensource_skills': opensource,
        # Scope breakdown
        'universal_skills': s.get('universal_skills', 0) or 0,
        'domain_skills': s.get('domain_skills', 0) or 0,
        'project_skills': s.get('project_skills', 0) or 0,
        # Lifecycle queues
        'pending_version_reviews': v.get('pending_reviews', 0) or 0,
        'approved_versions': v.get('approved', 0) or 0,
        'rejected_versions': v.get('rejected', 0) or 0,
        'total_matches': m.get('total_matches', 0) or 0,
        'pending_match_reviews': m.get('pending_reviews', 0) or 0,
        # Graph
        'dependencies': deps_count,
        'adoptions': adoption_count,

        # Legacy aliases — UI still renders these in some paths until Phase 3.1.
        'core_skills': synergi,
        'expert_skills': anthropic + opensource,
        'pending_reviews': v.get('pending_reviews', 0) or 0,
        'approved': m.get('approved', 0) or 0,
        'rejected': m.get('rejected', 0) or 0,
    }


def upsert_skill_sources(sources):
    """Upsert skill sources from registry sync."""
    client = get_admin_client()
    rows = []
    for s in sources:
        rows.append({
            'source_key': s['id'],
            'name': s['name'],
            'type': s['type'],
            'author_name': s.get('author', {}).get('name'),
            'author_email': s.get('author', {}).get('email'),
            'author_url': s.get('author', {}).get('url'),
            'license': s.get('license'),
            'repo_url': s.get('repoUrl'),
            'upstream_url': s.get('upstreamUrl'),
            'department': s.get('department'),
            'last_scanned_at': s.get('lastScannedAt'),
        })
    response = client.table('skill_sources').upsert(rows, on_conflict='source_key').execute()
    return len(response.data)


def upsert_skills(skills, source_map):
    """Upsert skills from registry sync. source_map: {source_key: source_uuid}.

    Translates the updater's JSON registry into the v2 skill_registry schema.
    Inputs that the updater doesn't yet emit (sourceType, scope, filePath, upstreamUrl)
    fall back to safe defaults — synergi-original / domain-generic / null.

    REQ-004 additions: tier, displayName, tagline, avatarUrl, content, lastSeenAt
    are passed through when present. Older payloads without these fields skip
    them (skill_registry's existing values stay intact).
    """
    client = get_admin_client()
    rows = []
    for s in skills:
        # Derive source_type: explicit override wins, else infer from isCoreSkill flag
        source_type = s.get('sourceType')
        if not source_type:
            source_type = 'synergi-original' if s.get('isCoreSkill') else 'open-source-passthrough'

        latest_hash = None
        if s.get('versions'):
            latest_hash = s['versions'][-1].get('contentHash')

        row = {
            'skill_id': s['id'],
            'slug': s['slug'],
            'name': s['name'],
            'description': s.get('description', ''),
            'department': s.get('department'),
            'category': s.get('category'),
            'source_id': source_map.get(s['sourceId']),
            'source_type': source_type,
            'scope': s.get('scope', 'domain-generic'),
            'file_path': s.get('filePath') or s.get('originalPath'),
            'upstream_url': s.get('upstreamUrl'),
            'author_name': s.get('author', {}).get('name'),
            'license': s.get('license'),
            'current_version': s.get('currentVersion', '1.0.0'),
            'content_hash': latest_hash,
            'has_command': s.get('hasCommand', False),
            'keywords': s.get('keywords', []),
            'discovered_at': s.get('discoveredAt'),
            'last_checked_at': s.get('lastCheckedAt'),
        }

        # REQ-004 fields — only attach if the producer supplied them, so legacy
        # payloads from sources that don't emit these fields don't blank out
        # previously-populated values.
        for src_key, db_col in (
            ('tier',        'tier'),
            ('displayName', 'display_name'),
            ('tagline',     'tagline'),
            ('avatarUrl',   'avatar_url'),
            ('content',     'content'),
            ('lastSeenAt',  'last_seen_at'),
        ):
            if src_key in s:
                row[db_col] = s[src_key]

        rows.append(row)
    synced = 0
    for i in range(0, len(rows), 50):
        batch = rows[i:i+50]
        response = client.table('skill_registry').upsert(batch, on_conflict='skill_id').execute()
        synced += len(response.data)
    return synced


def upsert_skill_versions(skills, skill_id_map):
    """Populate skill_versions from each skill's versions[] array.

    The current version of each skill is marked 'approved' (per REQ-001 §10
    decision: backfilled skills land as auto-approved). All other versions
    land as 'pending' for explicit review.
    """
    client = get_admin_client()
    rows = []
    for s in skills:
        skill_uuid = skill_id_map.get(s['id'])
        if not skill_uuid:
            continue
        current = s.get('currentVersion', '1.0.0')
        for v in s.get('versions', []):
            is_current = v.get('version') == current
            rows.append({
                'skill_id': skill_uuid,
                'version': v['version'],
                'content_hash': v.get('contentHash', ''),
                'change_type': v.get('changeType'),
                'review_status': 'approved' if is_current else 'pending',
                'discovered_at': v.get('changedAt'),
                'promoted_at': v.get('changedAt') if is_current else None,
            })
    synced = 0
    for i in range(0, len(rows), 100):
        batch = rows[i:i+100]
        response = client.table('skill_versions').upsert(batch, on_conflict='skill_id,version').execute()
        synced += len(response.data)
    return synced


def upsert_skill_matches(match_results, skill_id_map):
    """Replace the pending match set with the freshly-proposed batch.

    Per REQ-001 §10 (mirroring REQ-003's dependency idempotency model):
    DELETEs all current pending matches and INSERTs the new set in one
    atomic call cycle. Reviewed pairs (approved/rejected) are never
    touched. Pairs already reviewed are filtered out of the incoming
    set so the matcher doesn't re-propose them.

    skill_id_map: {skill_id_text: uuid}. Accepts both legacy
    (expertSkillId / coreSkillSlug) and v2 (candidateSkillId / matchedSkillId)
    match shapes — v2 is the matching engine's native output.
    """
    client = get_admin_client()

    # Build slug -> uuid map for legacy coreSkillSlug translation
    all_skills = client.table('skill_registry').select('id,slug').execute()
    slug_to_uuid = {s['slug']: s['id'] for s in all_skills.data}

    # Reviewed pairs are immutable from the matcher's perspective.
    reviewed = client.table('skill_matches').select(
        'candidate_skill_id,matched_skill_id'
    ).neq('review_status', 'pending').execute()
    reviewed_pairs = {(r['candidate_skill_id'], r['matched_skill_id']) for r in reviewed.data}

    # Filter + translate incoming candidates
    rows = []
    for m in match_results:
        candidate_uuid = (
            m.get('candidateSkillId')
            or skill_id_map.get(m.get('expertSkillId'))
        )
        matched_uuid = (
            m.get('matchedSkillId')
            or slug_to_uuid.get(m.get('coreSkillSlug'))
        )
        if not candidate_uuid or not matched_uuid:
            continue
        if candidate_uuid == matched_uuid:
            continue
        if (candidate_uuid, matched_uuid) in reviewed_pairs:
            continue
        rows.append({
            'candidate_skill_id': candidate_uuid,
            'matched_skill_id': matched_uuid,
            'match_type': m.get('matchType'),
            'confidence': m.get('confidence', 0),
            'reasoning': m.get('reasoning', ''),
            'review_status': 'pending',
        })

    # Idempotent rebuild of the pending tier — reviewed rows stay.
    client.table('skill_matches').delete().eq('review_status', 'pending').execute()

    if not rows:
        return 0

    synced = 0
    for i in range(0, len(rows), 200):
        batch = rows[i:i + 200]
        response = client.table('skill_matches').insert(batch).execute()
        synced += len(response.data)
    return synced


_UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)


def _resolve_skill_id(identifier):
    """Resolve a UUID, slug, or text skill_id to a UUID. Returns None if not found."""
    if _UUID_RE.match(identifier):
        return identifier

    client = get_public_client()
    # Try slug first (most user-facing form)
    lookup = client.table('skill_registry').select('id').eq('slug', identifier).execute()
    if lookup.data:
        return lookup.data[0]['id']
    # Fall back to text skill_id (e.g. 'core-synergi/biz-finance')
    lookup = client.table('skill_registry').select('id').eq('skill_id', identifier).execute()
    if lookup.data:
        return lookup.data[0]['id']
    return None


def get_skill_dependencies(identifier):
    """Get edges where this entry is the source (what it depends on).

    Returns None if the identifier doesn't resolve, else a list of graph rows.
    Reads from skill_dependency_graph view so callers get both ends' metadata.
    """
    uuid = _resolve_skill_id(identifier)
    if uuid is None:
        return None
    client = get_public_client()
    response = client.table('skill_dependency_graph').select('*').eq('skill_id', uuid).execute()
    return response.data


def get_skill_dependents(identifier):
    """Get edges where this entry is the target (what depends on it).

    Returns None if the identifier doesn't resolve, else a list of graph rows.
    """
    uuid = _resolve_skill_id(identifier)
    if uuid is None:
        return None
    client = get_public_client()
    response = client.table('skill_dependency_graph').select('*').eq('depends_on_id', uuid).execute()
    return response.data


def upsert_skill_dependencies(dependencies, skill_id_map):
    """Replace dependency edges for any source skill referenced in this sync (REQ-003).

    Per REQ-003 §10 decision 2: DELETE all edges for a re-scanned entry, then INSERT
    the new set. Idempotent; the table never accumulates phantom edges from old links.

    dependencies: list of {skillId, dependsOnId, linkText, linkTarget, linkKind}.
    skill_id_map: {skill_id_text: uuid}.
    """
    if not dependencies:
        return 0

    client = get_admin_client()

    # Collect source UUIDs we're touching this run
    source_uuids = set()
    rows = []
    for d in dependencies:
        src_uuid = skill_id_map.get(d.get('skillId'))
        dep_uuid = skill_id_map.get(d.get('dependsOnId'))
        if not src_uuid or not dep_uuid or src_uuid == dep_uuid:
            continue
        source_uuids.add(src_uuid)
        rows.append({
            'skill_id': src_uuid,
            'depends_on_id': dep_uuid,
            'link_text': d.get('linkText'),
            'link_target': d.get('linkTarget'),
            'link_kind': d.get('linkKind', 'inline-markdown'),
        })

    if not source_uuids:
        return 0

    # Delete existing edges for those sources (idempotent re-derivation)
    client.table('skill_dependencies').delete().in_('skill_id', list(source_uuids)).execute()

    if not rows:
        return 0

    # Insert the freshly derived edges in batches
    synced = 0
    for i in range(0, len(rows), 200):
        batch = rows[i:i + 200]
        response = client.table('skill_dependencies').insert(batch).execute()
        synced += len(response.data)
    return synced


def update_match_review(match_id, data):
    """Update a match review status."""
    client = get_admin_client()
    update_data = {
        'review_status': data['review_status'],
        'reviewer_notes': data.get('reviewer_notes', ''),
        'reviewed_by': data.get('reviewed_by', 'admin'),
    }
    response = client.table('skill_matches').update(update_data).eq('id', match_id).execute()
    return response.data[0] if response.data else None


def create_skill_adoption(data):
    """Create a skill adoption record. Accepts new skill_id or legacy expert_skill_id."""
    client = get_admin_client()
    skill_uuid = data.get('skill_id') or data.get('expert_skill_id')
    response = client.table('skill_adoptions').insert({
        'skill_id': skill_uuid,
        'adopted_version': data.get('adopted_version'),
        'notes': data.get('notes', ''),
    }).execute()
    return response.data[0] if response.data else None
