import 'server-only';
import { getModules } from '@/lib/modules/registry';
import { FileEventType, insertFileEvent, insertLlmCallEvent, insertQueryExecutionEvent } from './file-analytics.db';
import type { FileEvent, FileAnalyticsSummary, ConversationAnalyticsSummary } from './file-analytics.types';
import type { LLMCallDetail } from '@/lib/chat-orchestration';

export { FileEventType } from './file-analytics.db';
export { insertFileEvent, insertLlmCallEvent, insertQueryExecutionEvent };

/**
 * Track a single file event. Fire-and-forget.
 */
export function trackFileEvent(event: FileEvent): void {
  insertFileEvent({
    eventType: event.eventType,
    fileId: event.fileId,
    fileVersion: event.fileVersion ?? null,
    referencedByFileId: event.referencedByFileId ?? null,
    userId: event.userId ?? null,
  });
}

function toISOOrNull(val: unknown): string | null {
  if (val == null) return null;
  try { return new Date(val as string).toISOString(); } catch { return null; }
}

const AGGREGATION_SQL = `
SELECT
  COUNT(*) FILTER (WHERE event_type = ${FileEventType.READ_DIRECT}) AS "totalViews",
  COUNT(DISTINCT user_id) FILTER (WHERE event_type = ${FileEventType.READ_DIRECT}) AS "uniqueViewers",
  COUNT(*) FILTER (WHERE event_type = ${FileEventType.UPDATED}) AS "totalEdits",
  COUNT(DISTINCT user_id) FILTER (WHERE event_type = ${FileEventType.UPDATED}) AS "uniqueEditors",
  COUNT(DISTINCT referenced_by_file_id) FILTER (WHERE event_type = ${FileEventType.READ_AS_REFERENCE}) AS "usedByFiles",
  MIN(created_at) FILTER (WHERE event_type = ${FileEventType.CREATED}) AS "createdAt",
  MAX(created_at) FILTER (WHERE event_type = ${FileEventType.UPDATED}) AS "lastEditedAt"
FROM file_events
WHERE file_id = $1
`;

const CREATED_BY_SQL = `
SELECT u.email AS user_email
FROM file_events fe
LEFT JOIN users u ON u.id = fe.user_id
WHERE fe.file_id = $1 AND fe.event_type = ${FileEventType.CREATED}
ORDER BY fe.id ASC LIMIT 1
`;

const LAST_EDITED_BY_SQL = `
SELECT u.email AS user_email
FROM file_events fe
LEFT JOIN users u ON u.id = fe.user_id
WHERE fe.file_id = $1 AND fe.event_type = ${FileEventType.UPDATED}
ORDER BY fe.id DESC LIMIT 1
`;

/**
 * Fetch analytics summary for a single file.
 * Returns null on any error. Never throws.
 */
export async function getFileAnalyticsSummary(
  fileId: number,
): Promise<FileAnalyticsSummary | null> {
  try {
    const db = getModules().db;

    const [aggResult, createdByResult, lastEditedByResult] = await Promise.all([
      db.exec<Record<string, unknown>>(AGGREGATION_SQL, [fileId]),
      db.exec<Record<string, unknown>>(CREATED_BY_SQL, [fileId]),
      db.exec<Record<string, unknown>>(LAST_EDITED_BY_SQL, [fileId]),
    ]);

    const agg = aggResult.rows[0] ?? {};
    return {
      totalViews: Number(agg['totalViews'] ?? 0),
      uniqueViewers: Number(agg['uniqueViewers'] ?? 0),
      totalEdits: Number(agg['totalEdits'] ?? 0),
      uniqueEditors: Number(agg['uniqueEditors'] ?? 0),
      usedByFiles: Number(agg['usedByFiles'] ?? 0),
      createdAt: toISOOrNull(agg['createdAt']),
      lastEditedAt: toISOOrNull(agg['lastEditedAt']),
      createdBy: (createdByResult.rows[0]?.['user_email'] as string | null | undefined) ?? null,
      lastEditedBy: (lastEditedByResult.rows[0]?.['user_email'] as string | null | undefined) ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch analytics summaries for multiple files in one pass.
 * Returns empty {} on any error. Never throws.
 */
export async function getFilesAnalyticsSummary(
  fileIds: number[],
): Promise<Record<number, FileAnalyticsSummary>> {
  try {
    if (fileIds.length === 0) return {};
    const db = getModules().db;

    const BATCH_AGG_SQL = `
SELECT
  file_id AS "fileId",
  COUNT(*) FILTER (WHERE event_type = ${FileEventType.READ_DIRECT}) AS "totalViews",
  COUNT(DISTINCT user_id) FILTER (WHERE event_type = ${FileEventType.READ_DIRECT}) AS "uniqueViewers",
  COUNT(*) FILTER (WHERE event_type = ${FileEventType.UPDATED}) AS "totalEdits",
  COUNT(DISTINCT user_id) FILTER (WHERE event_type = ${FileEventType.UPDATED}) AS "uniqueEditors",
  COUNT(DISTINCT referenced_by_file_id) FILTER (WHERE event_type = ${FileEventType.READ_AS_REFERENCE}) AS "usedByFiles",
  MIN(created_at) FILTER (WHERE event_type = ${FileEventType.CREATED}) AS "createdAt",
  MAX(created_at) FILTER (WHERE event_type = ${FileEventType.UPDATED}) AS "lastEditedAt"
FROM file_events
WHERE file_id = ANY($1)
GROUP BY file_id
`;

    // DISTINCT ON: first (lowest id) user per file for CREATED events
    const BATCH_CREATED_BY_SQL = `
SELECT DISTINCT ON (fe.file_id)
  fe.file_id AS "fileId",
  u.email AS "createdBy"
FROM file_events fe
LEFT JOIN users u ON u.id = fe.user_id
WHERE fe.file_id = ANY($1) AND fe.event_type = ${FileEventType.CREATED}
ORDER BY fe.file_id, fe.id ASC
`;

    // DISTINCT ON: last (highest id) user per file for UPDATED events
    const BATCH_LAST_EDITED_BY_SQL = `
SELECT DISTINCT ON (fe.file_id)
  fe.file_id AS "fileId",
  u.email AS "lastEditedBy"
FROM file_events fe
LEFT JOIN users u ON u.id = fe.user_id
WHERE fe.file_id = ANY($1) AND fe.event_type = ${FileEventType.UPDATED}
ORDER BY fe.file_id, fe.id DESC
`;

    const [aggResult, createdByResult, lastEditedByResult] = await Promise.all([
      db.exec<Record<string, unknown>>(BATCH_AGG_SQL, [fileIds]),
      db.exec<Record<string, unknown>>(BATCH_CREATED_BY_SQL, [fileIds]),
      db.exec<Record<string, unknown>>(BATCH_LAST_EDITED_BY_SQL, [fileIds]),
    ]);

    const createdByMap = new Map<number, string | null>();
    for (const row of createdByResult.rows) {
      createdByMap.set(Number(row['fileId']), (row['createdBy'] as string | null | undefined) ?? null);
    }
    const lastEditedByMap = new Map<number, string | null>();
    for (const row of lastEditedByResult.rows) {
      lastEditedByMap.set(Number(row['fileId']), (row['lastEditedBy'] as string | null | undefined) ?? null);
    }

    const result: Record<number, FileAnalyticsSummary> = {};

    for (const row of aggResult.rows) {
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

interface QueryExecutionEvent {
  queryHash: string;
  query?: string | null;
  params?: Record<string, unknown> | null;
  schemaContext?: Array<{ schema: string; table: string; columns: string[] }> | null;
  databaseName: string | null;
  durationMs: number;
  rowCount: number;
  colCount?: number;
  wasCacheHit: boolean;
  error?: string | null;
  userId?: number | null;
}

/**
 * Track a query execution event. Fire-and-forget; errors logged only.
 */
export function trackQueryExecutionEvent(event: QueryExecutionEvent): void {
  insertQueryExecutionEvent({
    queryHash: event.queryHash,
    query: event.query ?? null,
    params: event.params ?? null,
    schemaContext: event.schemaContext ?? null,
    connectionName: event.databaseName ?? null,
    durationMs: event.durationMs,
    rowCount: event.rowCount,
    colCount: event.colCount ?? 0,
    wasCacheHit: event.wasCacheHit,
    error: event.error ?? null,
    userId: event.userId ?? null,
  });
}

/**
 * Track LLM call events for a conversation. Fire-and-forget; errors logged only.
 */
export function trackLLMCallEvents(
  llmCalls: Record<string, LLMCallDetail>,
  conversationId: number,
  userId: number | null,
): void {
  for (const call of Object.values(llmCalls)) {
    insertLlmCallEvent({
      conversationId,
      llmCallId: call.llm_call_id ?? null,
      model: call.model,
      totalTokens: call.total_tokens,
      promptTokens: call.prompt_tokens,
      completionTokens: call.completion_tokens,
      systemPromptTokens: call.system_prompt_tokens ?? 0,
      appStateTokens: call.app_state_tokens ?? 0,
      totalToolCalls: call.total_tool_calls ?? 0,
      cost: call.cost,
      durationS: call.duration,
      finishReason: call.finish_reason ?? null,
      trigger: call.trigger ?? null,
      userId: userId ?? null,
    });
  }
}

const CONV_AGG_SQL = `
SELECT
  model,
  COUNT(*) AS calls,
  SUM(total_tokens) AS tokens,
  SUM(cost) AS cost
FROM llm_call_events
WHERE conversation_id = $1
GROUP BY model
`;

/**
 * Fetch aggregated LLM analytics for a conversation.
 * Returns null if there are no rows or on any error.
 */
export async function getConversationAnalytics(
  conversationId: number,
): Promise<ConversationAnalyticsSummary | null> {
  try {
    const result = await getModules().db.exec<Record<string, unknown>>(CONV_AGG_SQL, [conversationId]);

    if (result.rows.length === 0) return null;

    const byModel: ConversationAnalyticsSummary['byModel'] = {};
    let totalCalls = 0;
    let totalTokens = 0;
    let totalCost = 0;

    for (const row of result.rows) {
      const model = String(row['model'] ?? '');
      const calls = Number(row['calls'] ?? 0);
      const tokens = Number(row['tokens'] ?? 0);
      const cost = Number(row['cost'] ?? 0);
      byModel[model] = { calls, tokens, cost };
      totalCalls += calls;
      totalTokens += tokens;
      totalCost += cost;
    }

    return { totalCalls, totalTokens, totalCost, byModel };
  } catch {
    return null;
  }
}
