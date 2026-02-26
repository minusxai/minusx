import 'server-only';
import { getAnalyticsDb, runStatement } from './file-analytics.db';
import { FileEvent } from './file-analytics.types';

const INSERT_SQL = `
INSERT INTO file_events
  (event_type, file_id, file_type, file_path, file_name, user_id, user_email, user_role, referenced_by_file_id, referenced_by_file_type)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/**
 * Track a single file event. Async, never throws — logs errors only.
 * Fire-and-forget: call without await from critical paths.
 */
export async function trackFileEvent(event: FileEvent): Promise<void> {
  const db = await getAnalyticsDb(event.companyId);

  await runStatement(db, INSERT_SQL, [
    event.eventType,
    event.fileId,
    event.fileType ?? null,
    event.filePath ?? null,
    event.fileName ?? null,
    event.userId ?? null,
    event.userEmail ?? null,
    event.userRole ?? null,
    event.referencedByFileId ?? null,
    event.referencedByFileType ?? null,
  ]);
}
