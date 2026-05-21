#!/usr/bin/env python3
"""
sync_skills.py — Canonical FS → DB sync for the skills registry.

`.agents/skills/` is the source of truth (authored from any harness:
Claude CLI, CoWork, Codex, IDE). The DB is a mirror so the Vercel
runtime and Higgins admin can see it. This script reads the filesystem,
derives the canonical row shape (REQ-001 fields + REQ-004 additions:
tier, display_name, tagline, content), and upserts into Supabase.

Why a dedicated sync tool (not the old backfill_skills.py):
  - Idempotent — re-run as often as needed; touches only changed rows
  - Stamps last_seen_at on every present slug, so admin UI can spot drift
  - Single source of truth lives on disk; harnesses other than Higgins
    can read/write the skill files directly without going through the DB.

USAGE
    python3 scripts/sync_skills.py             # sync everything against the live DB
    python3 scripts/sync_skills.py --dry-run   # show what would change, write nothing
    python3 scripts/sync_skills.py --verbose   # print one line per row touched

The sync hits Supabase directly using SUPABASE_SERVICE_ROLE_KEY from .env.local.
The HTTP POST path via /api/admin/skills/sync remains available for the
synergi-skills-updater repo (REQ-001 Phase 5) once it goes live.
"""

import argparse
import hashlib
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# Bootstrap path so we can import api.lib.supabase even when run from repo root.
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "api"))

# Load .env.local before importing the Supabase helpers (they read os.environ
# at import time for URL / key resolution).
def _load_env_local() -> None:
    env_file = REPO_ROOT / ".env.local"
    if not env_file.is_file():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        v = v.strip()
        if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
            v = v[1:-1]
        os.environ.setdefault(k.strip(), v)


_load_env_local()

# Configurable skills root — env override for non-default workspaces
SKILLS_ROOT = Path(
    os.environ.get("SKILLS_ROOT") or "/Users/jbh17/Documents/AIDevelopment/.agents/skills"
)
SOURCE_ID = "core-synergi"
REPO_RELATIVE_PREFIX = ".agents/skills"


# ── Frontmatter + content helpers ─────────────────────────────────────────

def parse_frontmatter(text: str) -> "tuple[dict, str]":
    """Return (meta, body) from a SKILL.md file. Minimal YAML parser — handles
    `key: value` with optional surrounding quotes. Synergi SKILL.md frontmatter
    is uniformly simple (name + description)."""
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", text, re.DOTALL)
    if not match:
        return {}, text
    fm_raw, body = match.group(1), match.group(2)
    meta = {}
    for line in fm_raw.splitlines():
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        key, val = key.strip(), val.strip()
        if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
            val = val[1:-1]
        meta[key] = val
    return meta, body


# Character name patterns. Two sources are reliable across the corpus:
#   1. The H1 body line: `# <Role / Title> — <Name>`  (every dept uses this)
#   2. The description frontmatter: `<role> agent (<Name>)` — the explicit
#      `agent` keyword discriminates real character names from generic
#      parentheticals like `(mission-critical)` in pm-spec-writer.
#
# H1 is the primary source because PM skills only have characters in the H1
# (the description doesn't carry them yet). The description regex is kept as
# a fallback for any skill whose H1 deviates from the convention.
H1_CHARACTER_RE = re.compile(
    r"^#\s+.+?\s+[—–-]\s+([A-Z][A-Za-z0-9\-]+)\s*$",
    re.MULTILINE,
)
DESC_CHARACTER_RE = re.compile(r"\bagent\s+\(([A-Z][A-Za-z0-9\-]+)\)")


def extract_display_name(description, body):
    """Pull the character name from the SKILL.md.

    Returns None when no character is matched. We deliberately do NOT fall
    back to the skill's `name` frontmatter — that field is uniformly the
    slug across the corpus, so falling back masks the real signal: which
    skills still need character names assigned. Drift admin will surface
    NULL display_names as a curator queue.
    """
    if body:
        m = H1_CHARACTER_RE.search(body)
        if m:
            return m.group(1)
    if description:
        m = DESC_CHARACTER_RE.search(description)
        if m:
            return m.group(1)
    return None


def extract_tagline(description, display_name, max_len=80):
    """Derive a one-line tagline from the description's leading sentence.

    Strategy:
      1. Take everything before the first ". " — that's the role/team line in
         the Synergi SKILL.md template.
      2. If a character name was extracted, strip the `agent (Name)` clause so
         the tagline doesn't repeat the name shown next to it on the card.
      3. Clip to max_len (default 80) at a word boundary.
    """
    if not description:
        return None
    head = description.split(". ", 1)[0].rstrip(".").strip()
    if display_name:
        # Remove either "agent (Name)" or just "(Name)" leftovers
        head = re.sub(rf"\s*agent\s+\({re.escape(display_name)}\)", "", head)
        head = re.sub(rf"\s*\({re.escape(display_name)}\)", "", head)
        head = re.sub(r"\s{2,}", " ", head).strip()
    if len(head) <= max_len:
        return head or None
    # Word-boundary clip
    clipped = head[:max_len].rsplit(" ", 1)[0].rstrip(",.;: -")
    return clipped + "…"


def derive_tier(slug: str, category: str) -> str:
    """REQ-004 tier taxonomy. See REQ-004 §8.

    Order matters: exec-orchestrator is a slug match before the generic
    *-orchestrator rule, and exec-* (other) before generic specialist.
    """
    if category == "context-reference":
        return "shared"
    if slug == "exec-orchestrator":
        return "top"
    if slug.endswith("-orchestrator"):
        return "orchestrator"
    if slug in ("exec-chief-of-staff", "exec-strategic-advisor"):
        return "exec_team"
    if slug.startswith("biz-"):
        return "cross_functional"
    return "specialist"


def rollup_folder_hash(skill_dir: Path) -> str:
    """SHA-256 over every .md file in the skill folder, name + body + null
    separators, alphabetical order. Identical algorithm to backfill_skills.py
    so existing content_hash values in the DB stay comparable."""
    h = hashlib.sha256()
    for md_file in sorted(skill_dir.glob("*.md")):
        h.update(md_file.name.encode("utf-8"))
        h.update(b"\x00")
        h.update(md_file.read_bytes())
        h.update(b"\x00")
    return h.hexdigest()


def extract_keywords(body: str, limit: int = 12) -> list:
    """Same keyword-from-headings logic as backfill_skills.py — kept in lockstep
    so re-syncs don't churn the keywords column unnecessarily."""
    STOP = {
        'the', 'and', 'for', 'this', 'that', 'these', 'those',
        'when', 'what', 'how', 'why', 'where', 'who', 'you', 'your', 'our',
        'use', 'using', 'used', 'uses',
        'include', 'includes', 'including',
        'with', 'from', 'into', 'over', 'about', 'against',
        'skill', 'skills', 'identity', 'context', 'sources',
        'rules', 'operating', 'output', 'formats', 'format',
        'boundaries', 'boundary', 'section', 'sections',
        'tools', 'examples', 'example', 'instructions',
    }
    words, seen = [], set()
    for h in re.findall(r"^##+\s+(.+?)$", body, re.MULTILINE):
        for w in re.findall(r"[A-Za-z][A-Za-z0-9]+", h):
            wl = w.lower()
            if len(wl) <= 2 or wl in seen or wl in STOP:
                continue
            seen.add(wl)
            words.append(wl)
            if len(words) >= limit:
                return words
    return words


def _first_paragraph(body: str) -> str:
    """First non-heading paragraph, trimmed. For shared/context-reference rows."""
    for chunk in re.split(r"\n\s*\n", body.strip()):
        chunk = chunk.strip()
        if not chunk:
            continue
        if all(line.lstrip().startswith("#") for line in chunk.splitlines()):
            continue
        lines = [ln for ln in chunk.splitlines() if not ln.lstrip().startswith("#")]
        text = " ".join(ln.strip() for ln in lines if ln.strip())
        if text:
            return text[:300]
    return ""


# ── Record builders ───────────────────────────────────────────────────────

def build_skill_entry(skill_dir, scan_time):
    """Build a registry row for a skill folder. Returns None when there's no SKILL.md."""
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        return None

    slug = skill_dir.name
    content = skill_md.read_text(encoding="utf-8")
    meta, body = parse_frontmatter(content)

    department = slug.split("-", 1)[0] if "-" in slug else "general"
    description = meta.get("description", "")
    name = meta.get("name", slug)
    display_name = extract_display_name(description, body)
    tagline = extract_tagline(description, display_name)
    tier = derive_tier(slug, "skill")
    content_hash = rollup_folder_hash(skill_dir)

    return {
        "id": f"{SOURCE_ID}/{slug}",
        "slug": slug,
        "name": name,
        "description": description,
        "department": department,
        "category": "skill",
        "sourceId": SOURCE_ID,
        "sourceType": "synergi-original",
        "scope": "domain-generic",
        "filePath": f"{REPO_RELATIVE_PREFIX}/{slug}",
        "upstreamUrl": None,
        "author": {"name": "Synergi AI"},
        "license": "proprietary",
        "originalPath": f"{slug}/SKILL.md",
        "currentVersion": "1.0.0",
        "versions": [
            {
                "version": "1.0.0",
                "changedAt": scan_time,
                "changeType": "initial",
                "contentHash": content_hash,
            }
        ],
        "isExpertSkill": False,
        "isCoreSkill": True,
        "hasCommand": False,
        "keywords": extract_keywords(body),
        "discoveredAt": scan_time,
        "lastCheckedAt": scan_time,
        # REQ-004 fields
        "tier": tier,
        "displayName": display_name,
        "tagline": tagline,
        "content": content,           # full SKILL.md body — DB mirror for Vercel runtime
        "lastSeenAt": scan_time,
    }


def build_context_entries(shared_dir: Path, scan_time: str) -> list:
    """Build registry rows for each .md file inside a *-shared folder. These
    are tagged category='context-reference' and tier='shared' — not callable
    agents, but other skills link to them, so they need governance."""
    if not shared_dir.name.endswith("-shared"):
        return []

    department = shared_dir.name.rsplit("-shared", 1)[0]
    entries = []
    for md_file in sorted(shared_dir.glob("*.md")):
        content = md_file.read_text(encoding="utf-8")
        content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
        stem = md_file.stem

        slug = f"{shared_dir.name}-{stem}"
        name = stem.replace("-", " ").replace("_", " ").title()
        description = _first_paragraph(content) or (
            f"Shared {department} context referenced by {department}-* skills."
        )
        tagline = extract_tagline(description, None)

        entries.append({
            "id": f"{SOURCE_ID}/{slug}",
            "slug": slug,
            "name": name,
            "description": description,
            "department": department,
            "category": "context-reference",
            "sourceId": SOURCE_ID,
            "sourceType": "synergi-original",
            "scope": "domain-generic",
            "filePath": f"{REPO_RELATIVE_PREFIX}/{shared_dir.name}/{md_file.name}",
            "upstreamUrl": None,
            "author": {"name": "Synergi AI"},
            "license": "proprietary",
            "originalPath": f"{shared_dir.name}/{md_file.name}",
            "currentVersion": "1.0.0",
            "versions": [
                {
                    "version": "1.0.0",
                    "changedAt": scan_time,
                    "changeType": "initial",
                    "contentHash": content_hash,
                }
            ],
            "isExpertSkill": False,
            "isCoreSkill": True,
            "hasCommand": False,
            "keywords": [],
            "discoveredAt": scan_time,
            "lastCheckedAt": scan_time,
            # REQ-004 fields
            "tier": "shared",
            "displayName": name,
            "tagline": tagline,
            "content": content,
            "lastSeenAt": scan_time,
        })
    return entries


# ── Sync driver ───────────────────────────────────────────────────────────

def collect_entries(scan_time: str) -> "tuple[list, list, list]":
    """Walk SKILLS_ROOT. Returns (skill_rows, context_rows, skipped_folders)."""
    skills, context_entries, skipped = [], [], []
    for entry in sorted(SKILLS_ROOT.iterdir()):
        if not entry.is_dir():
            continue
        if entry.name.endswith("-shared"):
            recs = build_context_entries(entry, scan_time)
            if not recs:
                skipped.append(f"{entry.name} (no .md files)")
                continue
            context_entries.extend(recs)
            continue
        record = build_skill_entry(entry, scan_time)
        if record is None:
            skipped.append(f"{entry.name} (no SKILL.md)")
            continue
        skills.append(record)
    return skills, context_entries, skipped


def main() -> int:
    p = argparse.ArgumentParser(description="Sync .agents/skills → DB")
    p.add_argument("--dry-run", action="store_true", help="Build + diff, no DB writes")
    p.add_argument("--verbose", action="store_true", help="Per-row reporting")
    args = p.parse_args()

    if not SKILLS_ROOT.is_dir():
        print(f"Skills root not found: {SKILLS_ROOT}", file=sys.stderr)
        return 1

    scan_time = datetime.now(timezone.utc).isoformat()

    skills, context_entries, skipped = collect_entries(scan_time)
    all_entries = skills + context_entries

    print(
        f"Scanned {SKILLS_ROOT}: {len(skills)} skills, {len(context_entries)} "
        f"context-references, {len(skipped)} skipped folders",
        file=sys.stderr,
    )
    if skipped and args.verbose:
        for s in skipped:
            print(f"  skipped: {s}", file=sys.stderr)

    if args.dry_run:
        # Print a summary table — slug, tier, display_name, tagline
        print("\nDRY RUN — rows that would be upserted:\n", file=sys.stderr)
        print(f"{'slug':<32} {'tier':<18} {'display_name':<18} tagline", file=sys.stderr)
        print("-" * 110, file=sys.stderr)
        for e in all_entries:
            tagline = (e.get("tagline") or "")[:60]
            print(
                f"{e['slug']:<32} {e['tier']:<18} {(e.get('displayName') or ''):<18} {tagline}",
                file=sys.stderr,
            )
        print(f"\n{len(all_entries)} total rows.", file=sys.stderr)
        return 0

    # Live sync — import here so dry-run can preview without env credentials
    from lib.supabase import (
        upsert_skill_sources, upsert_skills, upsert_skill_versions,
        get_skill_sources, get_all_skills,
    )

    sources = [{
        "id": SOURCE_ID,
        "type": "core",
        "name": "Synergi Core Skills",
        "author": {"name": "Synergi AI"},
        "license": "proprietary",
        "localPath": str(SKILLS_ROOT),
        "department": "multi",
        "lastScannedAt": scan_time,
    }]

    sources_synced = upsert_skill_sources(sources)
    db_sources = get_skill_sources()
    source_map = {s["source_key"]: s["id"] for s in db_sources}

    skills_synced = upsert_skills(all_entries, source_map)

    db_skills = get_all_skills()
    skill_id_map = {s["skill_id"]: s["id"] for s in db_skills}
    versions_synced = upsert_skill_versions(all_entries, skill_id_map)

    print(
        f"Sync complete: {sources_synced} source, {skills_synced} skills+context, "
        f"{versions_synced} versions touched.",
        file=sys.stderr,
    )

    if args.verbose:
        for e in all_entries:
            print(f"  {e['slug']:<32} tier={e['tier']:<18} display_name={e.get('displayName')}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
