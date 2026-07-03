import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
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

    const { data: file } = await loadFile(id, user); // access-checked
    if (!isRubricFileType(file.type)) {
      return ApiErrors.validationError(`Health rubric is only available for question, dashboard, and story files (got ${file.type})`);
    }

    return successResponse({ report: await scoreFile(file.type, file.content, user, screenshotUrl) });
  } catch (error) {
    return handleApiError(error);
  }
});
