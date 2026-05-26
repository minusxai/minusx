import { NextRequest } from 'next/server';
import { successResponse, handleApiError } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { loadFiles } from '@/lib/data/files.server';
import { validateFileIds } from '@/lib/data/helpers/validation';
import { FileEventType, trackFileEvents } from '@/lib/analytics/file-analytics.server';
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

    // Track read_direct for the whole batch in a single multi-row INSERT.
    // Previously this loop fired one INSERT per file, which Sentry flagged as
    // MINUSX-BI-A (N+1 INSERTs into file_events). We deliberately bypass
    // appEventRegistry.publish(FILE_VIEWED) here — that path fires both the
    // analytics INSERT *and* a per-event HTTP notify to MX_API_BASE_URL/notify,
    // which is also wasteful for bulk reads. Batched analytics keeps the
    // important signal (file-view counts); per-file notify for bulk loads is
    // dropped intentionally.
    trackFileEvents(result.data.map(file => ({
      eventType: FileEventType.READ_DIRECT,
      fileId: file.id,
      fileVersion: file.version,
      userId: user.userId,
    })));

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
