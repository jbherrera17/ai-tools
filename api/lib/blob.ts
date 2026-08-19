import { put } from '@vercel/blob';

/**
 * Vercel Blob upload helper — REQ-002 Phase 4.
 *
 * Uploads a server-rendered artifact (DocX, PPTX) to Vercel Blob and
 * returns the public URL. v1 uses `access: 'public'` because:
 *   - artifacts are JB-only (single-user) and not surfaced anywhere
 *     other than his Higgins UI
 *   - the URL is long, opaque, and unlisted (not enumerable)
 *   - keeping it public side-steps signed-URL expiry UX
 *
 * Switch to `access: 'private'` + signed URLs when multi-user lands.
 */

const ARTIFACT_PREFIX = 'higgins/artifacts';

const CONTENT_TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
};

export async function uploadArtifactBlob(args: {
  slug: string;
  version: number;
  ext: 'docx' | 'pptx' | 'pdf' | 'mp4';
  buffer: Buffer;
}): Promise<{ url: string; pathname: string; sizeBytes: number }> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error('BLOB_READ_WRITE_TOKEN is not set');
  }

  const pathname = `${ARTIFACT_PREFIX}/${args.slug}-v${args.version}.${args.ext}`;
  const contentType = CONTENT_TYPES[args.ext] ?? 'application/octet-stream';

  const result = await put(pathname, args.buffer, {
    access: 'public',
    contentType,
    token,
    addRandomSuffix: true, // collision-safe across re-renders
  });

  return { url: result.url, pathname: result.pathname, sizeBytes: args.buffer.length };
}

const UPLOAD_PREFIX = 'higgins/uploads';

/**
 * Uploads a user-attached chat file (image, PDF, or text) to Vercel Blob
 * and returns the public URL. Filenames are sanitized; a random suffix keeps
 * uploads collision-safe. Same public-access rationale as artifacts above.
 */
export async function uploadUserFileBlob(args: {
  name: string;
  mediaType: string;
  buffer: Buffer;
}): Promise<{ url: string; pathname: string; sizeBytes: number }> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error('BLOB_READ_WRITE_TOKEN is not set');
  }

  const safeName =
    (args.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file';
  const pathname = `${UPLOAD_PREFIX}/${safeName}`;

  const result = await put(pathname, args.buffer, {
    access: 'public',
    contentType: args.mediaType || 'application/octet-stream',
    token,
    addRandomSuffix: true,
  });

  return { url: result.url, pathname: result.pathname, sizeBytes: args.buffer.length };
}
