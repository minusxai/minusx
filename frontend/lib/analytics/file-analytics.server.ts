import 'server-only';
import { getAnalyticsDb, runStatement, runQuery } from './file-analytics.db';
import { FileEvent, FileAnalyticsSummary } from './file-analytics.types';

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

function toISOOrNull(val: unknown): string | null {
  if (val == null) return null;
  try { return new Date(val as any).toISOString(); } catch { return null; }
}

const AGGREGATION_SQL = `
SELECT
  COUNT(*) FILTER (WHERE event_type = 'read_direct') AS "totalViews",
  COUNT(DISTINCT user_id) FILTER (WHERE event_type = 'read_direct') AS "uniqueViewers",
  COUNT(*) FILTER (WHERE event_type = 'updated') AS "totalEdits",
  COUNT(DISTINCT user_id) FILTER (WHERE event_type = 'updated') AS "uniqueEditors",
  COUNT(DISTINCT referenced_by_file_id) FILTER (WHERE event_type = 'read_as_reference') AS "usedByFiles",
  MIN(timestamp) FILTER (WHERE event_type = 'created') AS "createdAt",
  MAX(timestamp) FILTER (WHERE event_type = 'updated') AS "lastEditedAt"
FROM file_events
WHERE file_id = ?
`;

const CREATED_BY_SQL = `
SELECT user_email FROM file_events
WHERE file_id = ? AND event_type = 'created'
ORDER BY id ASC LIMIT 1
`;

const LAST_EDITED_BY_SQL = `
SELECT user_email FROM file_events
WHERE file_id = ? AND event_type = 'updated'
ORDER BY id DESC LIMIT 1
`;

/**
 * Fetch analytics summary for a single file.
 * Returns null if the analytics DB doesn't exist yet or on any error.
 * Never throws.
 */
export async function getFileAnalyticsSummary(
  fileId: number,
  companyId: number
): Promise<FileAnalyticsSummary | null> {
  try {
    const db = await getAnalyticsDb(companyId);

    const [aggRows, createdByRows, lastEditedByRows] = await Promise.all([
      runQuery<Record<string, unknown>>(db, AGGREGATION_SQL, [fileId]),
      runQuery<Record<string, unknown>>(db, CREATED_BY_SQL, [fileId]),
      runQuery<Record<string, unknown>>(db, LAST_EDITED_BY_SQL, [fileId]),
    ]);

    const agg = aggRows[0] ?? {};
    return {
      totalViews: Number(agg['totalViews'] ?? 0),
      uniqueViewers: Number(agg['uniqueViewers'] ?? 0),
      totalEdits: Number(agg['totalEdits'] ?? 0),
      uniqueEditors: Number(agg['uniqueEditors'] ?? 0),
      usedByFiles: Number(agg['usedByFiles'] ?? 0),
      createdAt: toISOOrNull(agg['createdAt']),
      lastEditedAt: toISOOrNull(agg['lastEditedAt']),
      createdBy: (createdByRows[0]?.['user_email'] as string | null | undefined) ?? null,
      lastEditedBy: (lastEditedByRows[0]?.['user_email'] as string | null | undefined) ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch analytics summaries for multiple files in one pass.
 * Returns empty {} if the analytics DB doesn't exist yet or on any error.
 * Never throws.
 */
export async function getFilesAnalyticsSummary(
  fileIds: number[],
  companyId: number
): Promise<Record<number, FileAnalyticsSummary>> {
  try {
    if (fileIds.length === 0) return {};
    const db = await getAnalyticsDb(companyId);

    const placeholders = fileIds.map(() => '?').join(', ');

    const BATCH_AGG_SQL = `
SELECT
  file_id AS "fileId",
  COUNT(*) FILTER (WHERE event_type = 'read_direct') AS "totalViews",
  COUNT(DISTINCT user_id) FILTER (WHERE event_type = 'read_direct') AS "uniqueViewers",
  COUNT(*) FILTER (WHERE event_type = 'updated') AS "totalEdits",
  COUNT(DISTINCT user_id) FILTER (WHERE event_type = 'updated') AS "uniqueEditors",
  COUNT(DISTINCT referenced_by_file_id) FILTER (WHERE event_type = 'read_as_reference') AS "usedByFiles",
  MIN(timestamp) FILTER (WHERE event_type = 'created') AS "createdAt",
  MAX(timestamp) FILTER (WHERE event_type = 'updated') AS "lastEditedAt"
FROM file_events
WHERE file_id IN (${placeholders})
GROUP BY file_id
`;

    const BATCH_CREATED_BY_SQL = `
SELECT file_id AS "fileId", arg_min(user_email, id) AS "createdBy"
FROM file_events
WHERE file_id IN (${placeholders}) AND event_type = 'created'
GROUP BY file_id
`;

    const BATCH_LAST_EDITED_BY_SQL = `
SELECT file_id AS "fileId", arg_max(user_email, id) AS "lastEditedBy"
FROM file_events
WHERE file_id IN (${placeholders}) AND event_type = 'updated'
GROUP BY file_id
`;

    const [aggRows, createdByRows, lastEditedByRows] = await Promise.all([
      runQuery<Record<string, unknown>>(db, BATCH_AGG_SQL, fileIds),
      runQuery<Record<string, unknown>>(db, BATCH_CREATED_BY_SQL, fileIds),
      runQuery<Record<string, unknown>>(db, BATCH_LAST_EDITED_BY_SQL, fileIds),
    ]);

    // Index by fileId
    const createdByMap = new Map<number, string | null>();
    for (const row of createdByRows) {
      createdByMap.set(Number(row['fileId']), (row['createdBy'] as string | null | undefined) ?? null);
    }
    const lastEditedByMap = new Map<number, string | null>();
    for (const row of lastEditedByRows) {
      lastEditedByMap.set(Number(row['fileId']), (row['lastEditedBy'] as string | null | undefined) ?? null);
    }

    const result: Record<number, FileAnalyticsSummary> = {};

    // Populate from aggregation rows (only files with at least one event)
    for (const row of aggRows) {
      const fid = Number(row['fileId']);
      result[fid] = {
        totalViews: Number(row['totalViews'] ?? 0),
        uniqueViewers: Number(row['uniqueViewers'] ?? 0),
        totalEdits: Number(row['totalEdits'] ?? 0),
        uniqueEditors: Number(row['uniqueEditors'] ?? 0),
        usedByFiles: Number(row['usedByFiles'] ?? 0),
        createdAt: toISOOrNull(row['createdAt']),
        lastEditedAt: toISOOrNull(row['lastEditedAt']),
        createdBy: createdByMap.get(fid) ?? null,
        lastEditedBy: lastEditedByMap.get(fid) ?? null,
      };
    }

    // Fill zero-entries for file IDs with no events at all (GROUP BY omits them)
    const zero: FileAnalyticsSummary = {
      totalViews: 0, uniqueViewers: 0,
      totalEdits: 0, uniqueEditors: 0,
      usedByFiles: 0,
      createdAt: null, createdBy: null,
      lastEditedAt: null, lastEditedBy: null,
    };
    for (const fid of fileIds) {
      if (result[fid] === undefined) result[fid] = zero;
    }

    return result;
  } catch (err) {
    console.error('[analytics] getFilesAnalyticsSummary failed:', err);
    return {};
  }
}
