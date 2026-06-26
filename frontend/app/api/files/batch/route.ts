import { NextRequest } from 'next/server';
import { successResponse, handleApiError } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { loadFiles } from '@/lib/data/files.server';
import { validateFileIds } from '@/lib/data/helpers/validation';
import { FileEventType, trackFileEvents } from '@/lib/analytics/file-analytics.server';

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
    // appEventRegistry.publish(FILE_VIEWED) here — that path fires the per-event
    // analytics INSERT (and the app_events log + webhook fan-out), which is
    // wasteful for bulk reads. Batched analytics keeps the important signal
    // (file-view counts); per-file event publish for bulk loads is dropped intentionally.
    trackFileEvents(result.data.map(file => ({
      eventType: FileEventType.READ_DIRECT,
      fileId: file.id,
      fileVersion: file.version,
      userId: user.userId,
    })));

    // v=2 conversations serve the orchestrator pi ConversationLog as-is (frontend parses it via
    // parsePiConversation); v=1 + other files pass through unchanged. No down-translation on read.
    if (include !== 'references') {
      return successResponse(result.data);
    }

    return successResponse({ ...result, data: result.data });
  } catch (error) {
    return handleApiError(error);
  }
});
