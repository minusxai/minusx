import 'server-only';
import { getModules } from '@/lib/modules/registry';
import { headers } from 'next/headers';
import { FileEventTypeValue } from './file-analytics.types';

export { FileEventType } from './file-analytics.types';
export type { FileEventTypeValue } from './file-analytics.types';

export interface InsertFileEventParams {
  eventType: FileEventTypeValue;
  fileId: number;
  fileVersion?: number | null;
  referencedByFileId?: number | null;
  userId?: number | null;
}

export interface InsertLlmCallEventParams {
  conversationId: number;
  llmCallId?: string | null;
  provider?: string | null;
  model: string;
  mode?: string | null;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  cacheCreationTokens?: number;
  reasoningTokens?: number;
  systemPromptTokens?: number;
  appStateTokens?: number;
  totalToolCalls?: number;
  cost: number;
  durationS: number;
  stream?: boolean;
  finishReason?: string | null;
  trigger?: string | null;
  userId?: number | null;
}

export interface InsertLlmLogParams {
  callId: string;
  userId?: number | null;
  provider?: string | null;
  model?: string | null;
  requestJson: string;
  responseJson: string;
  error?: string | null;
}

export interface InsertFeedbackEventParams {
  conversationId: number;
  userMessageLogIndex: number;
  rating: 'positive' | 'negative';
  tags: string[];
  comment?: string;
  userId?: number | null;
}

export interface InsertQueryExecutionEventParams {
  queryHash: string;
  fileId?: number | null;
  fileVersion?: number | null;
  query?: string | null;
  params?: Record<string, unknown> | null;
  schemaContext?: Array<{ schema: string; table: string; columns: string[] }> | null;
  connectionName?: string | null;
  durationMs: number;
  rowCount: number;
  colCount?: number;
  wasCacheHit: boolean;
  error?: string | null;
  userId?: number | null;
}

async function getRequestId(): Promise<string | null> {
  try {
    const h = await headers();
    return h.get('x-request-id');
  } catch {
    return null;
  }
}

function fireAndForget(promise: Promise<unknown>): void {
  promise.catch((err) => console.error('[analytics] insert failed:', err));
}

export function insertFileEvent(p: InsertFileEventParams): void {
  fireAndForget((async () => {
    const requestId = await getRequestId();
    await getModules().db.exec(
      `INSERT INTO file_events (event_type, file_id, file_version, referenced_by_file_id, user_id, request_id)
       VALUES ($1, $2, $3, $4, $5, $6::uuid)`,
      [p.eventType, p.fileId, p.fileVersion ?? null, p.referencedByFileId ?? null, p.userId ?? null, requestId]
    );
  })());
}

/**
 * Batched variant of insertFileEvent — one multi-row INSERT instead of N
 * single-row INSERTs. Sentry MINUSX-BI-A flagged the N+1 produced by callers
 * (notably /api/files/batch) doing 11 sequential INSERTs in a tight loop.
 */
export function insertFileEvents(events: InsertFileEventParams[]): void {
  if (events.length === 0) return;
  fireAndForget((async () => {
    const requestId = await getRequestId();
    const valueGroups: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    for (const p of events) {
      valueGroups.push(`($${i}, $${i + 1}, $${i + 2}, $${i + 3}, $${i + 4}, $${i + 5}::uuid)`);
      params.push(
        p.eventType,
        p.fileId,
        p.fileVersion ?? null,
        p.referencedByFileId ?? null,
        p.userId ?? null,
        requestId,
      );
      i += 6;
    }
    await getModules().db.exec(
      `INSERT INTO file_events (event_type, file_id, file_version, referenced_by_file_id, user_id, request_id)
       VALUES ${valueGroups.join(', ')}`,
      params
    );
  })());
}

/**
 * Awaitable INSERT into llm_call_events. Errors are caught + logged (never
 * thrown), so callers can `await` it to guarantee the row is persisted (e.g.
 * before a request handler returns — unawaited promises aren't kept alive in a
 * standalone prod build) without risking the request.
 */
export async function recordLlmCallEvent(p: InsertLlmCallEventParams): Promise<void> {
  try {
    const requestId = await getRequestId();
    await getModules().db.exec(
      `INSERT INTO llm_call_events
         (conversation_id, llm_call_id, provider, model, mode,
          total_tokens, prompt_tokens, completion_tokens,
          cached_tokens, cache_creation_tokens, reasoning_tokens,
          system_prompt_tokens, app_state_tokens, total_tool_calls,
          cost, duration_s, stream, finish_reason, trigger, user_id, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::uuid)`,
      [
        p.conversationId, p.llmCallId ?? null, p.provider ?? null, p.model, p.mode ?? null,
        p.totalTokens, p.promptTokens, p.completionTokens,
        p.cachedTokens ?? 0, p.cacheCreationTokens ?? 0, p.reasoningTokens ?? 0,
        p.systemPromptTokens ?? 0, p.appStateTokens ?? 0, p.totalToolCalls ?? 0,
        p.cost, p.durationS, p.stream ?? false, p.finishReason ?? null, p.trigger ?? null,
        p.userId ?? null, requestId,
      ]
    );
  } catch (err) {
    console.error('[analytics] llm_call_events insert failed:', err);
  }
}

export function insertLlmCallEvent(p: InsertLlmCallEventParams): void {
  fireAndForget(recordLlmCallEvent(p));
}

/**
 * Awaitable INSERT of the raw pi-format request/response for one LLM call.
 * Local only — never forwarded. Errors caught + logged. `await` to guarantee
 * the blob persists before the handler returns.
 */
export async function recordLlmLog(p: InsertLlmLogParams): Promise<void> {
  try {
    await getModules().db.exec(
      `INSERT INTO llm_logs (call_id, user_id, provider, model, request_json, response_json, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (call_id) DO NOTHING`,
      [
        p.callId, p.userId ?? null, p.provider ?? null, p.model ?? null,
        p.requestJson, p.responseJson, p.error ?? null,
      ]
    );
  } catch (err) {
    console.error('[analytics] llm_logs insert failed:', err);
  }
}

export function insertLlmLog(p: InsertLlmLogParams): void {
  fireAndForget(recordLlmLog(p));
}

/** Read one LLM log blob row by call id (for the Debug UI). */
export async function getLlmLog(callId: string): Promise<Record<string, unknown> | null> {
  const res = await getModules().db.exec<Record<string, unknown>>(
    `SELECT call_id, provider, model, request_json, response_json, error, created_at
       FROM llm_logs WHERE call_id = $1`,
    [callId]
  );
  return res.rows[0] ?? null;
}

/** Read one per-call stats row by call id (for the Debug UI). */
export async function getLlmCallStats(callId: string): Promise<Record<string, unknown> | null> {
  const res = await getModules().db.exec<Record<string, unknown>>(
    `SELECT llm_call_id, provider, model, mode, total_tokens, prompt_tokens, completion_tokens,
            cached_tokens, cache_creation_tokens, reasoning_tokens, cost, duration_s, stream,
            finish_reason, trigger, created_at
       FROM llm_call_events WHERE llm_call_id = $1
       ORDER BY created_at DESC LIMIT 1`,
    [callId]
  );
  return res.rows[0] ?? null;
}

/** Delete LLM log blobs created strictly before `before`. Returns rows removed. */
export async function clearLlmLogsBefore(before: Date): Promise<number> {
  const res = await getModules().db.exec<{ call_id: string }>(
    `DELETE FROM llm_logs WHERE created_at < $1 RETURNING call_id`,
    [before.toISOString()]
  );
  return res.rows.length;
}

export function insertQueryExecutionEvent(p: InsertQueryExecutionEventParams): void {
  fireAndForget((async () => {
    const requestId = await getRequestId();
    await getModules().db.exec(
      `WITH _q AS (
         INSERT INTO queries (query_hash, query, params, schema_context, connection_name, file_id, file_version)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7)
         ON CONFLICT DO NOTHING
       )
       INSERT INTO query_execution_events
         (query_hash, file_id, duration_ms, row_count, col_count, was_cache_hit, error, user_id, request_id)
       VALUES ($1, $6, $8, $9, $10, $11, $12, $13, $14::uuid)`,
      [
        p.queryHash,
        p.query ?? null,
        p.params ? JSON.stringify(p.params) : null,
        p.schemaContext ? JSON.stringify(p.schemaContext) : null,
        p.connectionName ?? null,
        p.fileId ?? null,
        p.fileVersion ?? null,
        p.durationMs, p.rowCount, p.colCount ?? 0, p.wasCacheHit,
        p.error ?? null,
        p.userId ?? null,
        requestId,
      ]
    );
  })());
}

export function insertFeedbackEvent(p: InsertFeedbackEventParams): void {
  fireAndForget((async () => {
    const requestId = await getRequestId();
    await getModules().db.exec(
      `INSERT INTO feedback_events
         (conversation_id, user_message_log_index, rating, tags, comment, user_id, request_id)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::uuid)`,
      [
        p.conversationId, p.userMessageLogIndex, p.rating,
        JSON.stringify(p.tags), p.comment ?? '', p.userId ?? null, requestId,
      ]
    );
  })());
}
