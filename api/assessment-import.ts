import type { VercelRequest, VercelResponse } from '@vercel/node';
import pdfParse from 'pdf-parse';

/**
 * Restore a previously generated AI Readiness report from its saved PDF.
 *
 * POST /api/assessment-import
 *   { filename?: string, dataBase64: string }    // whole PDF, base64-encoded
 *   -> 200 { report: {...} }
 *   -> 422 { error, code: 'no-payload' }           // no embedded markers found
 *   -> 422 { error, code: 'unsupported-version' }  // schemaVersion this endpoint doesn't know
 *   -> 400 { error, code: 'malformed' }             // markers found but decode/parse failed
 *   -> 413 { error, code: 'too-large' }
 *
 * The PDF is produced by synergi-website's print flow, which embeds a small,
 * genuinely-printed (not hidden) machine-readable copy of the full report as
 * base64 JSON between two sentinel markers, wrapped for print layout. See
 * docs/ai-readiness-assessment-technical.md Part 1.3 for why this exists and
 * why it isn't encrypted.
 *
 * Stateless — nothing here is written anywhere. The PDF is parsed in memory
 * and forgotten once the response is sent. No auth: same public, unauthenticated
 * posture as synergi-website's assessment endpoints, and this one makes zero
 * model calls at all, so it carries none of their cost risk.
 */

export const config = { maxDuration: 15 };

const MARKER_START = '===HA-REPORT-DATA-V1-START===';
const MARKER_END = '===HA-REPORT-DATA-V1-END===';
const SUPPORTED_SCHEMA_VERSIONS = new Set([1]);

// A report PDF is a few hundred KB. This is a generous ceiling, not a target —
// Vercel's own platform-level request body limit will likely reject anything
// this large before the function is even invoked; this check exists to give a
// clean, on-brand error for whatever does get through, rather than relying on
// the platform's raw rejection.
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

interface ImportedReport {
  schemaVersion: number;
  generatedAt: string;
  company: string;
  overall: number;
  stage: { number: number; name: string };
  headline: string;
  axes: Array<Record<string, unknown>>;
  prioritySequence: Array<Record<string, unknown>>;
  upskilling: Record<string, unknown>;
  suggestedProjects: Array<Record<string, unknown>>;
}

/**
 * Shape check only — deliberately not a full schema validator. Anything that
 * passes this but is subtly wrong (e.g. a malformed axis entry deep inside
 * the array) is the renderer's problem to be defensive about, the same way
 * synergi-website's own scoring.js never trusts a field's shape blindly. This
 * check exists to catch "this obviously isn't a report" (wrong file, stray
 * JSON from something else that happened to sit between two matching-looking
 * strings) before it reaches the browser as if it were valid.
 */
function isImportedReportShape(v: unknown): v is ImportedReport {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.schemaVersion === 'number' &&
    typeof r.overall === 'number' &&
    typeof r.headline === 'string' &&
    Array.isArray(r.axes) &&
    Array.isArray(r.prioritySequence) &&
    Array.isArray(r.suggestedProjects) &&
    typeof r.upskilling === 'object' &&
    r.upskilling !== null
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const dataBase64 = typeof req.body?.dataBase64 === 'string' ? req.body.dataBase64 : '';
  if (!dataBase64) {
    res.status(400).json({ error: 'No file data received.', code: 'malformed' });
    return;
  }

  // Strip a data-URL prefix if the client sent one (e.g. from FileReader's
  // readAsDataURL: "data:application/pdf;base64,....").
  const base64 = dataBase64.includes(',') ? dataBase64.slice(dataBase64.indexOf(',') + 1) : dataBase64;
  const buffer = Buffer.from(base64, 'base64');

  if (buffer.length === 0) {
    res.status(400).json({ error: 'That file appears to be empty.', code: 'malformed' });
    return;
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    res.status(413).json({
      error: 'That file is larger than expected for an assessment report — please upload the original PDF.',
      code: 'too-large',
    });
    return;
  }

  let text: string;
  try {
    const parsed = await pdfParse(buffer);
    text = parsed.text || '';
  } catch {
    res.status(400).json({
      error: "We couldn't read that as a PDF. Please upload the original file, unedited.",
      code: 'malformed',
    });
    return;
  }

  // Strip ALL whitespace before searching, not just the text between the
  // markers. A PDF's print layout wraps lines at points that have nothing to
  // do with word boundaries in the source text, so a marker itself can end up
  // split across a line break — a literal search for the intact marker string
  // would then silently fail to find real, valid data. Matching against the
  // whitespace-free text makes the search immune to wherever the PDF happened
  // to wrap. (No risk of this merging unrelated prose into a false match: the
  // marker is a distinctive 30-character uppercase token that doesn't occur
  // naturally in report prose.)
  const normalized = text.replace(/\s+/g, '');
  const startIdx = normalized.indexOf(MARKER_START);
  const endIdx = startIdx === -1 ? -1 : normalized.indexOf(MARKER_END, startIdx + MARKER_START.length);

  if (startIdx === -1 || endIdx === -1) {
    res.status(422).json({
      error:
        "We couldn't find assessment data in this PDF. It may have been generated before this feature existed — you're welcome to retake the assessment.",
      code: 'no-payload',
    });
    return;
  }

  const payloadBase64 = normalized.slice(startIdx + MARKER_START.length, endIdx);

  let report: unknown;
  try {
    const json = Buffer.from(payloadBase64, 'base64').toString('utf8');
    report = JSON.parse(json);
  } catch {
    res.status(400).json({
      error: "This PDF's assessment data looks corrupted — please upload the original file, unedited.",
      code: 'malformed',
    });
    return;
  }

  if (!isImportedReportShape(report)) {
    res.status(400).json({
      error: "This PDF's assessment data is not in a format we recognise.",
      code: 'malformed',
    });
    return;
  }

  if (!SUPPORTED_SCHEMA_VERSIONS.has(report.schemaVersion)) {
    res.status(422).json({
      error: 'This report was generated by a newer version of the assessment tool. Please retake the assessment or download a fresh copy.',
      code: 'unsupported-version',
    });
    return;
  }

  res.status(200).json({ report });
}
