import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
import { getServiceClient } from './lib/supabaseClient.js';

/**
 * Default avatar generator — REQ-004 Phase 2 §10.
 *
 * GET /api/avatar?slug=<skill-slug>[&size=128]
 *
 * Returns an SVG with a two-letter monogram on a deterministic gradient
 * from the Synergi palette. The slug → gradient mapping is hash-stable
 * so the same agent always lands on the same gradient pair across
 * deploys. Higgins (`exec-orchestrator`) 302s to the 3D portrait
 * (`/images/higgins.svg`) so team-modal cards and `/api/avatar`
 * consumers show the real face instead of the HG monogram. Other slugs
 * keep the SVG monogram.
 *
 * Caching: 24h public CDN cache. When the character name changes the
 * sync script bumps `last_seen_at` but the avatar URL doesn't carry
 * a version — for v1 that's fine (defaults are static). v2 hand-drawn
 * portraits stored on Vercel Blob will use signed URLs.
 *
 * Hand-designed character portraits (the v2 ambition per REQ-004 §10)
 * sit in `skill_registry.avatar_url`. When that column is non-NULL,
 * `/api/avatar` should 302 to the blob URL — but that path lands in
 * a later phase, so v1 always renders the SVG monogram here (except
 * Higgins, who now redirects to `/images/higgins.svg`).
 */

export const config = { maxDuration: 5 };

// Synergi palette gradient pairs (REQ-004 §10). Deterministic pick.
const GRADIENTS: Array<[string, string]> = [
  ['#77bde0', '#85ecf8'],  // cyan
  ['#b78bd3', '#f0d4fa'],  // violet
  ['#dc9171', '#ffe7ba'],  // amber
  ['#77bde0', '#b78bd3'],  // cyan → violet
  ['#b78bd3', '#dc9171'],  // violet → amber
  ['#dc9171', '#77bde0'],  // amber → cyan
];

interface AvatarRow {
  slug: string;
  display_name: string | null;
  name: string | null;
}

function hashIndex(s: string, mod: number): number {
  const h = createHash('sha1').update(s).digest();
  // Take 4 bytes as an unsigned int for a stable bucket pick.
  const n = h.readUInt32BE(0);
  return n % mod;
}

function monogramFromDisplayName(displayName: string | null, fallback: string): string {
  const source = displayName?.trim() || fallback;
  // Strip the disambiguating "-X" suffix so Cameron-H shows "CA" not "C-".
  const base = source.replace(/-[A-Z]$/u, '');
  if (!base) return '??';
  // Two-letter monogram: first two letters of a single token, or first
  // letters of the first two tokens when the name contains a space.
  const tokens = base.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    return (tokens[0][0] + tokens[1][0]).toUpperCase();
  }
  return tokens[0].slice(0, 2).toUpperCase();
}

function renderSvg(args: {
  slug: string;
  monogram: string;
  gradient: [string, string];
  size: number;
  withRing: boolean;
}): string {
  const { slug, monogram, gradient, size, withRing } = args;
  const gradId = `g-${slug.replace(/[^a-z0-9-]/gi, '')}`;
  // Single-line viewBox keeps the SVG compact; DM Serif Display is the
  // personal-tools brand font (per global CLAUDE.md), so the monogram
  // matches the rest of the Higgins UI even if Tailwind isn't applied.
  const ring = withRing
    ? `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 2}" fill="none" stroke="#ffffff" stroke-width="2" />`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${slug} avatar">
  <defs>
    <linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${gradient[0]}" />
      <stop offset="100%" stop-color="${gradient[1]}" />
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${size / 2}" fill="url(#${gradId})" />
  ${ring}
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"
        font-family="'DM Serif Display', 'Georgia', serif"
        font-size="${Math.round(size * 0.42)}"
        font-weight="400"
        fill="#1a1a2e"
        letter-spacing="0.5">${monogram}</text>
</svg>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const slug = (req.query.slug as string | undefined)?.trim();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    res.status(400).json({ error: 'slug query param required (lowercase letters, digits, hyphens)' });
    return;
  }

  // Higgins portrait — team-modal cards and other /api/avatar consumers
  // should show the 3D face, not the HG SVG monogram.
  if (slug === 'exec-orchestrator') {
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, immutable');
    res.redirect(302, '/images/higgins.svg');
    return;
  }

  const sizeRaw = parseInt(String(req.query.size ?? '128'), 10);
  const size = Number.isFinite(sizeRaw) && sizeRaw >= 24 && sizeRaw <= 512 ? sizeRaw : 128;

  // Look up display_name. Falls back to the slug — for unsynced or
  // hand-inserted rows the avatar still renders something readable.
  let display_name: string | null = null;
  let nameFallback = slug;
  try {
    const sb = getServiceClient();
    const { data } = await sb
      .from('skill_registry')
      .select('slug, display_name, name')
      .eq('slug', slug)
      .maybeSingle();
    if (data) {
      const row = data as AvatarRow;
      display_name = row.display_name;
      nameFallback = row.name ?? slug;
    }
  } catch (err) {
    // DB hiccup is non-fatal — render based on the slug alone.
    console.warn('[avatar] DB lookup failed, rendering from slug', (err as Error).message);
  }

  const monogram = monogramFromDisplayName(display_name, nameFallback);
  const gradient = GRADIENTS[hashIndex(slug, GRADIENTS.length)];
  const withRing = slug === 'exec-orchestrator';

  const svg = renderSvg({ slug, monogram, gradient, size, withRing });

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, immutable');
  res.status(200).send(svg);
}
