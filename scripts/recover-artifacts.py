#!/usr/bin/env python3
"""One-off recovery: pull every Higgins artifact to ./recovered-artifacts/.

DOCX/PPTX come from their Vercel Blob URL. Markdown/code/text are
reconstructed from higgins_artifact_versions by walking versions oldest->newest
and applying body snapshots / patches (mirrors api/conversation.ts).
"""
import json, os, re, sys, urllib.request

BASE = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_SERVICE_KEY"]
OUT = os.path.join(os.getcwd(), "recovered-artifacts")
os.makedirs(OUT, exist_ok=True)

HDR = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}


def rest(path):
    req = urllib.request.Request(f"{BASE}/rest/v1/{path}", headers=HDR)
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def slug(s):
    return re.sub(r"[^A-Za-z0-9._-]+", "-", s).strip("-")[:80] or "untitled"


EXT = {"docx": "docx", "pptx": "pptx", "markdown": "md", "code": "txt", "text": "txt", "html": "html"}

arts = rest("higgins_artifacts?select=id,slug,conversation_id,type,title,blob_url,current_version&order=updated_at.desc")
print(f"Found {len(arts)} artifacts\n")
saved = []
for a in arts:
    # Prefix with the conversation short-id so identically-titled artifacts
    # from different conversations don't overwrite each other.
    name = f"{a['conversation_id'][:8]}__{slug(a['title'])}.v{a['current_version']}.{EXT.get(a['type'], 'txt')}"
    dest = os.path.join(OUT, name)
    try:
        if a["blob_url"]:
            with urllib.request.urlopen(a["blob_url"]) as r, open(dest, "wb") as f:
                f.write(r.read())
        else:
            versions = rest(f"higgins_artifact_versions?artifact_id=eq.{a['id']}&select=version_no,content&order=version_no.asc")
            body = ""
            for v in versions:
                c = v.get("content") or {}
                if c.get("body") is not None:
                    body = c["body"]
                elif c.get("patch"):
                    p = c["patch"]
                    body = p["content"] if p.get("mode") == "replace" else body + p.get("content", "")
            with open(dest, "w", encoding="utf-8") as f:
                f.write(body)
        size = os.path.getsize(dest)
        saved.append((name, a["conversation_id"], size))
        print(f"  ✓ {name}  ({size:,} bytes)  conv={a['conversation_id'][:8]}…")
    except Exception as e:
        print(f"  ✗ {name}  FAILED: {e}", file=sys.stderr)

print(f"\nSaved {len(saved)} files to {OUT}")
convs = sorted(set(c for _, c, _ in saved))
print(f"Spanning {len(convs)} conversation(s): " + ", ".join(convs))
