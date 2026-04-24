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
  model: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  systemPromptTokens?: number;
  appStateTokens?: number;
  totalToolCalls?: number;
  cost: number;
  durationS: number;
  finishReason?: string | null;
  trigger?: string | null;
  userId?: number | null;
}

export interface InsertQueryExecutionEventParams {
  queryHash: string;
  fileId?: number | null;
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

export function insertLlmCallEvent(p: InsertLlmCallEventParams): void {
  fireAndForget((async () => {
    const requestId = await getRequestId();
    await getModules().db.exec(
      `INSERT INTO llm_call_events
         (conversation_id, llm_call_id, model, total_tokens, prompt_tokens, completion_tokens,
          system_prompt_tokens, app_state_tokens, total_tool_calls,
          cost, duration_s, finish_reason, trigger, user_id, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::uuid)`,
      [
        p.conversationId, p.llmCallId ?? null, p.model,
        p.totalTokens, p.promptTokens, p.completionTokens,
        p.systemPromptTokens ?? 0, p.appStateTokens ?? 0, p.totalToolCalls ?? 0,
        p.cost, p.durationS, p.finishReason ?? null, p.trigger ?? null,
        p.userId ?? null, requestId,
      ]
    );
  })());
}

export function insertQueryExecutionEvent(p: InsertQueryExecutionEventParams): void {
  fireAndForget((async () => {
    const requestId = await getRequestId();
    await getModules().db.exec(
      `INSERT INTO query_execution_events
         (query_hash, file_id, query, params, schema_context, connection_name,
          duration_ms, row_count, col_count, was_cache_hit, error, user_id, request_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13::uuid)`,
      [
        p.queryHash,
        p.fileId ?? null,
        p.query ?? null,
        p.params ? JSON.stringify(p.params) : null,
        p.schemaContext ? JSON.stringify(p.schemaContext) : null,
        p.connectionName ?? null,
        p.durationMs, p.rowCount, p.colCount ?? 0, p.wasCacheHit,
        p.error ?? null,
        p.userId ?? null,
        requestId,
      ]
    );
  })());
}
