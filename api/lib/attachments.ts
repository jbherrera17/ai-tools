/**
 * Shared attachment policy for Higgins chat file uploads.
 *
 * Scope (per product decision): images, PDF, and plain-text/CSV/markdown/code.
 * Office docs (docx/xlsx/pptx) are intentionally out of scope for v1 — they
 * need server-side parsing libraries.
 */

export type AttachmentKind = 'image' | 'pdf' | 'text';

/** Allowed upload media types → how the chat backend should feed them to Claude. */
export const ALLOWED_MEDIA_TYPES: Record<string, AttachmentKind> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'application/pdf': 'pdf',
  'text/plain': 'text',
  'text/markdown': 'text',
  'text/csv': 'text',
  'application/json': 'text',
  'text/javascript': 'text',
  'application/javascript': 'text',
  'text/html': 'text',
  'text/css': 'text',
  'text/x-python': 'text',
};

/** Hard cap on a single decoded upload (bytes). Stays under Vercel's request-body limit. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Max attachments accepted on a single chat turn. */
export const MAX_ATTACHMENTS_PER_TURN = 5;

/** Vercel Blob public host suffix — attachment URLs must live here. */
export const BLOB_HOST_SUFFIX = '.blob.vercel-storage.com';

export function kindForMediaType(mediaType: string): AttachmentKind | null {
  return ALLOWED_MEDIA_TYPES[mediaType] ?? null;
}
