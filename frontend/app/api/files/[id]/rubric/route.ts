import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import { loadFile } from '@/lib/data/files.server';
import { validateFileId } from '@/lib/data/helpers/validation';
import { isRubricFileType } from '@/lib/rubric/registry';
import { scoreFile, scoreFileDeterministicResolved } from '@/lib/rubric/score-file.server';

// File health rubric (see docs/rubrik.md).
//   GET  → deterministic report (score + findings), computed from content.
//   POST → deterministic + LLM judge, combined. Body: { screenshot?: <data URL>, screenshotUrl?: <https URL> }.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/files/[id]/rubric — deterministic report. */
export const GET = withAuth(async (
  _request: NextRequest,
  user,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const id = validateFileId((await params).id);
    const { data: file } = await loadFile(id, user); // access-checked
    if (!isRubricFileType(file.type)) {
      return ApiErrors.validationError(`Health rubric is only available for question, dashboard, and story files (got ${file.type})`);
    }
    return successResponse({ report: await scoreFileDeterministicResolved(file.type, file.content, user) });
  } catch (error) {
    return handleApiError(error);
  }
});

/** POST /api/files/[id]/rubric — deterministic + LLM judge (combined). */
export const POST = withAuth(async (
  request: NextRequest,
  user,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const id = validateFileId((await params).id);
    const body = await request.json().catch(() => ({}));
    // Accept a client-captured `data:` URL or an already-uploaded https URL (screenshot tool).
    const screenshotUrl = typeof body?.screenshotUrl === 'string' ? body.screenshotUrl as string
      : (typeof body?.screenshot === 'string' && body.screenshot.startsWith('data:') ? body.screenshot as string : undefined);

    const { data: file } = await loadFile(id, user); // access-checked (type + ACL)
    if (!isRubricFileType(file.type)) {
      return ApiErrors.validationError(`Health rubric is only available for question, dashboard, and story files (got ${file.type})`);
    }

    // The screenshot the judge grades is the caller's LIVE view = merged content (saved + unsaved
    // edits). Score that same content when supplied, so the rubric doesn't judge stale saved markup
    // against a fresh picture. Fall back to the saved DB snapshot when the caller sends none.
    const content = body?.content && typeof body.content === 'object' ? body.content : file.content;

    // MEASURED embed widths from the caller's rendered iframe (real pixels; supersede the static
    // CSS width estimate). Validated defensively — malformed entries are dropped, never fatal.
    const measuredEmbeds = Array.isArray(body?.measuredEmbeds)
      ? (body.measuredEmbeds as unknown[])
          .map((m) => m as { vizType?: unknown; widthPx?: unknown; columnPx?: unknown })
          .filter((m) => m && typeof m.widthPx === 'number' && typeof m.columnPx === 'number' && m.widthPx >= 0 && m.columnPx > 0)
          .map((m) => ({ ...(typeof m.vizType === 'string' ? { vizType: m.vizType } : {}), widthPx: m.widthPx as number, columnPx: m.columnPx as number }))
      : undefined;

    return successResponse({ report: await scoreFile(file.type, content, user, screenshotUrl, measuredEmbeds) });
  } catch (error) {
    return handleApiError(error);
  }
});
