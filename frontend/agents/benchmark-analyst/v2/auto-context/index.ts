import 'server-only';

import type {
  AssistantMessage,
  Message,
  TextContent,
  ToolResultMessage,
} from '@mariozechner/pi-ai';
import type { Api, Model } from '@/lib/llm/get-model';
import type { ConversationLogEntry, MXAgentDetails } from '@/orchestrator/types';
import { type PromptPassCallLLM, extractText } from '../prompt-pass';
import { AutoContextAgent } from './auto-context-agent';
import {
  type AutoContextPayload,
  parseAutoContextPayload,
} from './payload-shape';
import { renderAutoContextPayload } from './render';
import { type FlatColumn } from './schema';
import { EMPTY_USAGE } from '@/orchestrator/utils';

export { AutoContextAgent } from './auto-context-agent';
export {
  type AutoContextPayload,
  AutoContextPayloadSchema,
  parseAutoContextPayload,
} from './payload-shape';
export { renderAutoContextPayload } from './render';
export {
  buildCatalogSummary,
  catalogProjection,
  makeFetchTableSample,
  renderCatalogSummary,
  type CatalogSummary,
} from './catalog-summary';

export const AUTO_CONTEXT_MAX_CHARS = 100_000;

// ─── Filter step: LLM picks relevant tables given a question ────────────────

const FILTER_SYSTEM_PROMPT = `You select tables from a database catalog that are relevant to a user's question.

Given the schema (table names + column types) and the question, return a JSON
array of the table identifiers most relevant to the question. Use the literal
form "<connection>.<schema>.<table>" exactly as shown.

- Include tables whose names or columns match concepts in the question.
- Include tables joined to those (the agent will need them too).
- Exclude tables that are obviously unrelated.

Respond with ONLY a JSON array of strings — no prose, no code fences:
["conn.schema.table_a","conn.schema.table_b", ...]`;

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

export function parseFilterResponse(text: string): Set<string> {
  try {
    const raw = JSON.parse(stripFences(text));
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.filter((s): s is string => typeof s === 'string'));
  } catch {
    return new Set();
  }
}

function renderSchemaForFilter(schema: FlatColumn[]): string {
  const byTable = new Map<string, string[]>();
  for (const c of schema) {
    const id = `${c.connection}.${c.schema}.${c.table}`;
    let cols = byTable.get(id);
    if (!cols) { cols = []; byTable.set(id, cols); }
    cols.push(`${c.column}:${c.type}`);
  }
  return [...byTable.entries()].map(([id, cols]) => `${id} — ${cols.join(', ')}`).join('\n');
}

export async function filterSchemaByQuestion(
  schema: FlatColumn[],
  userMessage: string,
  contextDocs: string | undefined,
  model: Model<Api>,
  callLLM: PromptPassCallLLM,
): Promise<Set<string>> {
  const userContent = [
    `## Original question\n${userMessage}`,
    contextDocs ? `## Data Documentation\n${contextDocs}` : null,
    `## Schema\n${renderSchemaForFilter(schema)}`,
    `## Task\nReturn JSON array of relevant table identifiers per the system rules.`,
  ].filter(Boolean).join('\n\n');

  const text = extractText(
    await callLLM(model, {
      systemPrompt: FILTER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent, timestamp: Date.now() }],
      tools: [],
    }),
  );
  return parseFilterResponse(text);
}

/** Heuristic for the filter trigger: rough char count of the schema-only
 *  render. Cheap, pure. */
export function estimateSchemaChars(schema: FlatColumn[]): number {
  return schema.reduce((sum, c) =>
    sum +
    c.connection.length + c.schema.length + c.table.length +
    c.column.length + c.type.length + 8,
    0,
  );
}

// ─── Process-wide payload cache ──────────────────────────────────────────────

// eslint-disable-next-line no-restricted-syntax -- server-only; process-wide cache of structured AutoContext payloads keyed by (datasetKey, slot, fingerprint)
export const autoContextStore = new Map<string, Promise<AutoContextPayload>>();

export function clearAutoContextCache(): void {
  autoContextStore.clear();
}

export function fingerprint(ids: Iterable<string>): string {
  return [...new Set(ids)].sort().join('|');
}

// ─── Synthetic message builders ──────────────────────────────────────────────

/** Synthetic assistant message that carries an AutoContextAgent toolCall.
 *  Used both by the dispatch path (passed to `orchestrator.dispatch`) and
 *  by the cache-hit path (pushed straight to the parent's toolThread). */
export function buildAutoContextSynthAssistant(
  toolCallId: string,
  catalogSummaryText: string,
): AssistantMessage {
  return {
    role: 'assistant',
    content: [{
      type: 'toolCall',
      id: toolCallId,
      name: AutoContextAgent.schema.name,
      arguments: { userMessage: catalogSummaryText },
    }],
    api: 'controller' as never,
    provider: 'controller',
    model: 'controller',
    usage: EMPTY_USAGE,
    stopReason: 'toolUse',
    timestamp: Date.now(),
  };
}

/** Cache-hit twin of the dispatch's wrapped AutoContextAgent toolResult.
 *  Carries the cached payload back as a `<AutoContext>{...}</AutoContext>`
 *  text block under `details.assistantMessage`, so downstream payload
 *  extraction (`extractAutoContextPayload`) treats cache-hit and
 *  cache-miss wrappers identically. */
export function buildAutoContextCacheHitWrapper(
  toolCallId: string,
  payload: AutoContextPayload,
): ToolResultMessage {
  const taggedText = `<AutoContext>${JSON.stringify(payload)}</AutoContext>`;
  return {
    role: 'toolResult',
    toolCallId,
    toolName: AutoContextAgent.schema.name,
    content: [{ type: 'text', text: `AutoContext (cached) — ${payload.tables.length} table(s), ${payload.examples.length} example(s).` }],
    isError: false,
    details: {
      type: 'mx_agent',
      assistantMessage: {
        role: 'assistant',
        content: [{ type: 'text', text: taggedText }],
        api: 'controller' as never,
        provider: 'controller',
        model: 'controller',
        usage: EMPTY_USAGE,
        stopReason: 'stop',
        timestamp: Date.now(),
      },
    } as MXAgentDetails,
    timestamp: Date.now(),
  };
}

// ─── Payload extraction ──────────────────────────────────────────────────────

/** Outcome of pulling a payload from the AutoContextAgent invocation's
 *  wrapped toolResult. On failure, includes the agent's final text so the
 *  caller's error message can show what the LLM emitted instead. */
export type ExtractResult =
  | { ok: true; payload: AutoContextPayload }
  | { ok: false; finalText: string; reason: 'no-tag' | 'bad-json' | 'no-wrapper' };

/** Pull the AutoContextAgent's parsed payload from a single wrapped
 *  `toolResult` message. Works for both dispatch results and cache-hit
 *  synthetic wrappers (both carry `details.assistantMessage`). */
export function extractAutoContextPayload(wrapper: ToolResultMessage | undefined): ExtractResult {
  if (!wrapper) return { ok: false, finalText: '', reason: 'no-wrapper' };
  const details = wrapper.details as MXAgentDetails | undefined;
  if (details?.type !== 'mx_agent') return { ok: false, finalText: '', reason: 'no-wrapper' };
  const finalText = details.assistantMessage.content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  const payload = parseAutoContextPayload(finalText);
  if (payload) return { ok: true, payload };
  return {
    ok: false,
    finalText,
    reason: /<AutoContext>/i.test(finalText) ? 'bad-json' : 'no-tag',
  };
}

/** Walk the orchestrator log for the AutoContextAgent invocation under
 *  `agentId`, find its wrapped toolResult, and extract the payload. */
export function extractAutoContextPayloadFromLog(
  log: ConversationLogEntry[],
  agentId: string,
): ExtractResult {
  for (const entry of log) {
    if (!('role' in entry) || entry.role !== 'toolResult') continue;
    if (entry.toolCallId !== agentId) continue;
    if (entry.toolName !== AutoContextAgent.schema.name) continue;
    return extractAutoContextPayload(entry);
  }
  return { ok: false, finalText: '', reason: 'no-wrapper' };
}

/** Predicate: is this message part of an AutoContextAgent dispatch pair
 *  identified by `dispatchId`? Used by callers that need to remove the
 *  pair from a `toolThread` before threading it into an LLM prompt. */
export function isAutoContextDispatchMessage(m: Message, dispatchId: string): boolean {
  if (!('role' in m)) return false;
  if (m.role === 'toolResult' && m.toolCallId === dispatchId) return true;
  if (m.role === 'assistant' && Array.isArray(m.content)) {
    return m.content.some(
      (c) => c.type === 'toolCall' && c.id === dispatchId && c.name === AutoContextAgent.schema.name,
    );
  }
  return false;
}

/** Splice the `(synthAssistant, wrappedToolResult)` pair for `dispatchId`
 *  out of `arr`, mutating in place. The orchestrator's log keeps the
 *  immutable record. */
export function spliceAutoContextDispatchPair(arr: Message[], dispatchId: string): void {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (isAutoContextDispatchMessage(arr[i], dispatchId)) {
      arr.splice(i, 1);
    }
  }
}
