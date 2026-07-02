import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { loadFile } from '@/lib/data/files.server';
import { validateFileId } from '@/lib/data/helpers/validation';
import { isRubricFileType, scoreFileDeterministic } from '@/lib/rubric/registry';
import { judgeFile, combineReports } from '@/lib/rubric/judge/judge.server';

// File health rubric (see docs/rubrik.md).
//   GET  → deterministic report (score + findings), computed from content.
//   POST → deterministic + LLM judge, combined. Body: { screenshot?: <data URL>, llmJudge?: true }.
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
    return successResponse({ report: scoreFileDeterministic(file.type, file.content) });
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
    const screenshotUrl = typeof body?.screenshot === 'string' && body.screenshot.startsWith('data:')
      ? body.screenshot as string
      : undefined;

    const { data: file } = await loadFile(id, user); // access-checked
    if (!isRubricFileType(file.type)) {
      return ApiErrors.validationError(`Health rubric is only available for question, dashboard, and story files (got ${file.type})`);
    }

    const deterministic = scoreFileDeterministic(file.type, file.content);
    const judge = await judgeFile({ fileType: file.type, content: file.content, screenshotUrl });
    return successResponse({ report: combineReports(deterministic, judge) });
  } catch (error) {
    return handleApiError(error);
  }
});
