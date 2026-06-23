import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { setJsxFile } from '@/lib/data/files.server';
import { validateFileId } from '@/lib/data/helpers/validation';

// File Architecture v2: set a file's static-JSX body. Validates the jsx (allowlisted
// components, static-only) and writes the `jsx` column — independent of the content
// publish path. Used by the SetJsx / EditJsx agent tools.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** POST /api/files/[id]/jsx — body: { jsx: string }. Returns { data: <updated file> }. */
export const POST = withAuth(async (
  request: NextRequest,
  user,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const id = validateFileId((await params).id);
    const body = await request.json().catch(() => ({}));
    const jsx = typeof body?.jsx === 'string' ? body.jsx : null;
    if (jsx === null) {
      return ApiErrors.validationError('jsx (string) is required');
    }
    const result = await setJsxFile(id, jsx, user);
    // successResponse already wraps in { success, data } — pass the file directly,
    // NOT { data: ... }, or the client receives a double-wrapped { data: { data: file } }
    // and setFile() gets a malformed object (no type/jsx → blank derived content).
    return successResponse(result.data);
  } catch (error) {
    return handleApiError(error);
  }
});
