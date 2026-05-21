import { NextRequest } from 'next/server';
import { successResponse, handleApiError } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { loadFiles } from '@/lib/data/files.server';
import { validateFileIds } from '@/lib/data/helpers/validation';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import { translateConversationForFrontend } from '@/lib/chat-translator';

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
        fileVersion: file.version,
        fileType: file.type,
        filePath: file.path,
        fileName: file.name,
        userId: user.userId,
        userEmail: user.email,
        userRole: user.role,

        mode: user.mode,
      });
    }

    // v=2 conversations: translate orchestrator content.log → legacy task-log so
    // the frontend never sees orchestrator log shape. v=1 files pass through unchanged.
    const translatedData = result.data.map(translateConversationForFrontend);

    if (include !== 'references') {
      return successResponse(translatedData);
    }

    return successResponse({ ...result, data: translatedData });
  } catch (error) {
    return handleApiError(error);
  }
});
