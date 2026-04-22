import { NextRequest } from 'next/server';
import { successResponse, handleApiError } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { loadFiles } from '@/lib/data/files.server';
import { validateFileIds } from '@/lib/data/helpers/validation';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';

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

    // Track read_direct for each loaded file (fire-and-forget, non-blocking)
    for (const file of result.data) {
      appEventRegistry.publish(AppEvents.FILE_VIEWED, {
        fileId: file.id,
        fileType: file.type,
        filePath: file.path,
        fileName: file.name,
        userId: user.userId,
        userEmail: user.email,
        userRole: user.role,
        
        mode: user.mode,
      });
    }

    if (include !== 'references') {
      return successResponse(result.data);
    }

    return successResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
});
