import { NextRequest } from 'next/server';
import { successResponse, handleApiError } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { loadFiles } from '@/lib/data/files.server';
import { validateFileIds } from '@/lib/data/helpers/validation';

/**
 * POST /api/files/batch
 * Load multiple files by IDs, optionally with all their references
 *
 * Body: { ids: number[], include?: 'references' }
 */
export const POST = withAuth(async (
  request: NextRequest,
  user
) => {
  try {
    const body = await request.json();
    const { ids, include } = body;

    const validatedIds = validateFileIds(ids);
    const result = await loadFiles(validatedIds, user);

    if (include !== 'references') {
      return successResponse(result.data);
    }

    return successResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
});
