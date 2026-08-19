import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireOwner } from './lib/auth.js';
import { uploadUserFileBlob } from './lib/blob.js';
import {
  kindForMediaType,
  MAX_UPLOAD_BYTES,
} from './lib/attachments.js';

/**
 * Higgins 2.0 chat file upload.
 *
 *   POST /api/upload  { name, mediaType, dataBase64 }  → { url, name, mediaType, kind, size }
 *
 * Accepts a base64-encoded image, PDF, or text file, validates type + size,
 * stores it in Vercel Blob, and returns the public URL. The chat endpoint
 * then feeds the file to Claude (images/PDFs natively, text inlined).
 *
 * Node-style handler required by @vercel/node@3. Owner-gated.
 */

interface UploadBody {
  name?: unknown;
  mediaType?: unknown;
  dataBase64?: unknown;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireOwner(req, res)) return;

  let body: UploadBody = {};
  if (typeof req.body === 'string') {
    try { body = JSON.parse(req.body) as UploadBody; }
    catch { res.status(400).json({ error: 'Invalid JSON body' }); return; }
  } else if (req.body && typeof req.body === 'object') {
    body = req.body as UploadBody;
  }

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'file';
  const mediaType = typeof body.mediaType === 'string' ? body.mediaType.trim() : '';
  const dataBase64 = typeof body.dataBase64 === 'string' ? body.dataBase64 : '';

  const kind = kindForMediaType(mediaType);
  if (!kind) {
    res.status(415).json({ error: `Unsupported file type: ${mediaType || 'unknown'}` });
    return;
  }
  if (!dataBase64) {
    res.status(400).json({ error: 'dataBase64 is required' });
    return;
  }

  // Strip any data-URL prefix the client may have left on.
  const b64 = dataBase64.includes(',') ? dataBase64.slice(dataBase64.indexOf(',') + 1) : dataBase64;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(b64, 'base64');
  } catch {
    res.status(400).json({ error: 'Invalid base64 data' });
    return;
  }
  if (buffer.length === 0) {
    res.status(400).json({ error: 'Empty file' });
    return;
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    res.status(413).json({
      error: `File too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Max ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)}MB.`,
    });
    return;
  }

  try {
    const { url, sizeBytes } = await uploadUserFileBlob({ name, mediaType, buffer });
    res.status(200).json({ url, name, mediaType, kind, size: sizeBytes });
  } catch (err) {
    console.error('[higgins/upload] failed', err);
    res.status(500).json({ error: 'Upload failed' });
  }
}
