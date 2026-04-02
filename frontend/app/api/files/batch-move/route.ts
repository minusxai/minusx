import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { FilesAPI } from '@/lib/data/files.server';

/**
 * POST /api/files/batch-move
 * Move multiple files to a new destination folder in a single request.
 *
 * Body: { files: Array<{ id: number; name: string; destFolder: string }> }
 *
 * Response: { data: Array<{ id: number; name: string; path: string; oldPath: string }> }
 */
export const POST = withAuth(async (
  request: NextRequest,
  user
) => {
  try {
    const body = await request.json();
    const { files } = body;

    if (!Array.isArray(files) || files.length === 0) {
      return ApiErrors.validationError('files must be a non-empty array');
    }

    for (const entry of files) {
      const { id, name, destFolder } = entry;
      if (!id || !name || !destFolder) {
        return ApiErrors.validationError('Each file must have id, name, and destFolder');
      }
    }

    const inputs = files.map(({ id, name, destFolder }: { id: number; name: string; destFolder: string }) => ({
      id,
      name,
      newPath: `${destFolder}/${name}`,
    }));

    const results = await FilesAPI.batchMoveFiles(inputs, user);
    return successResponse(results);
  } catch (error) {
    return handleApiError(error);
  }
});
