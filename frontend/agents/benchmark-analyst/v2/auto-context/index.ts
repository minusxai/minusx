import 'server-only';

import type {
  AssistantMessage,
  ToolResultMessage,
} from '@mariozechner/pi-ai';
import type { NodeConnector } from '@/lib/connections/base';
import type { Api, Model } from '@/lib/llm/get-model';
import type { ConversationLogEntry, MXAgent } from '@/orchestrator/types';
import type { Orchestrator } from '@/orchestrator/orchestrator';
import { gen_id } from '@/orchestrator/utils';
import { getOrCreateBenchmarkConnector } from '../../shared-duckdb';
import type { ConnectionInfo } from '../../types';
import { getCatalogStore } from '../catalog';
import { type PromptPassCallLLM, extractText } from '../prompt-pass';
import { getLighterModel } from '../data-tool-base';
import { AutoContextAgent } from './auto-context-agent';
import {
  type AutoContextPayload,
  FinishAutoContext,
  type FinishAutoContextDetails,
} from './finish-tool';
import {
  buildCatalogSummary,
  catalogProjection,
  makeFetchTableSample,
  renderCatalogSummary,
  type CatalogSummary,
} from './catalog-summary';
import { renderAutoContextPayload } from './render';
import { type FlatColumn } from './schema';

export { AutoContextAgent } from './auto-context-agent';
export { FinishAutoContext, type AutoContextPayload } from './finish-tool';
export { renderAutoContextPayload } from './render';

const DEFAULT_MAX_CHARS = 100_000;

// ─── Filter step: LLM picks relevant tables given a question ────────────────
//
// Used when the full catalog summary would exceed the agent's prompt budget.
// The fingerprint of the returned table set goes into the cache key — two
// questions whose filter resolves to the same set share an AutoContext
// payload.

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

/** `estimateSchemaChars` from the prior pipeline — kept as the filter
 *  trigger heuristic. */
export function estimateSchemaChars(schema: FlatColumn[]): number {
  return schema.reduce((sum, c) =>
    sum +
    c.connection.length + c.schema.length + c.table.length +
    c.column.length + c.type.length + 8,
    0,
  );
}

// ─── Cache ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-restricted-syntax -- server-only; process-wide cache of structured AutoContext payloads keyed by (datasetKey, slot, fingerprint)
const autoContextStore = new Map<string, Promise<AutoContextPayload>>();

export function clearAutoContextCache(): void {
  autoContextStore.clear();
}

function fingerprint(ids: Iterable<string>): string {
  return [...new Set(ids)].sort().join('|');
}

// ─── Synthetic message builders ──────────────────────────────────────────────

function buildSynthAssistant(toolCallId: string, catalogSummaryText: string): AssistantMessage {
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
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'toolUse',
    timestamp: Date.now(),
  };
}

function buildRenderedResult(toolCallId: string, rendered: string): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId,
    toolName: AutoContextAgent.schema.name,
    content: [{ type: 'text', text: rendered }],
    isError: false,
    timestamp: Date.now(),
  };
}

/** Walk the orchestrator log looking for a `FinishAutoContext` toolResult
 *  emitted by the agent whose id is `agentId`. Returns null if the agent
 *  finished without calling it (which the caller treats as failure). */
function findFinishAutoContextPayload(
  log: ConversationLogEntry[],
  agentId: string,
): AutoContextPayload | null {
  for (const entry of log) {
    if (!('role' in entry) || entry.role !== 'toolResult') continue;
    if (entry.parent_id !== agentId) continue;
    if (entry.toolName !== FinishAutoContext.schema.name) continue;
    const details = entry.details as FinishAutoContextDetails | undefined;
    if (details?.type === 'auto_context') return details.payload;
  }
  return null;
}

// ─── Top-level entry point ───────────────────────────────────────────────────

export interface RunAutoContextOpts {
  orchestrator: Orchestrator;
  parent: MXAgent;
  connections: ConnectionInfo[] | undefined;
  datasetKey: string;
  /** Per-slot discriminator (DoubleCheck sets this to 'agent-a'/'agent-b'). */
  cacheKey?: string;
  /** The user's question. Required to drive the filter step on huge schemas;
   *  without it the agent only ever sees the unfiltered catalog summary. */
  userMessage?: string;
  /** Data documentation passed to the filter step. The agent itself reads
   *  it off `parent.context.contextDocs` via its own system prompt. */
  contextDocs?: string;
  maxChars?: number;
  /** Override the default lighter model used for the filter step + the
   *  AutoContextAgent's own LLM loop. */
  model?: Model<Api>;
}

/**
 * Top-level AutoContext entry point. Builds the agent's catalog summary,
 * decides whether to filter (large schemas) or run unfiltered (small),
 * dispatches `AutoContextAgent` via the orchestrator (cache miss) or
 * synthesises the `(toolCall, toolResult)` pair from cache (hit), and
 * splices the pair into `parent.threadHistory` so the parent's first LLM
 * turn sees AutoContext as already-established prior tool use.
 *
 * Cache is per `(datasetKey, slot, filterFingerprint)`. The agent's
 * `userMessage` is always question-agnostic, so cross-row reuse is safe.
 */
export async function runAutoContextAgent(opts: RunAutoContextOpts): Promise<void> {
  const {
    orchestrator,
    parent,
    connections,
    datasetKey,
    cacheKey: slot = 'default',
    userMessage,
    contextDocs,
    maxChars = DEFAULT_MAX_CHARS,
  } = opts;
  const model = opts.model ?? getLighterModel();

  // 1) Build the cached catalog + projections.
  const catalogCacheKey = `auto-${slot}`;
  const { catalog } = await getCatalogStore(connections, catalogCacheKey, undefined, datasetKey);
  const { schema, statsByCol, rowCountByTable } = catalogProjection(catalog);
  if (schema.length === 0) return; // no connections → nothing to do

  // 2) Filter-vs-full decision.
  const callLLM: PromptPassCallLLM = (m, c) =>
    orchestrator.callLLM(m, c, parent.id, { maxTokens: 4096 });

  let effectiveSchema = schema;
  let cacheSuffix: string;
  if (estimateSchemaChars(schema) > maxChars && userMessage) {
    const allowed = await filterSchemaByQuestion(schema, userMessage, contextDocs, model, callLLM);
    if (allowed.size > 0) {
      effectiveSchema = schema.filter(
        (c) => allowed.has(`${c.connection}.${c.schema}.${c.table}`),
      );
      cacheSuffix = `f:${fingerprint(allowed)}`;
    } else {
      // Filter LLM returned nothing useful — fall back to unfiltered.
      cacheSuffix = 'full';
    }
  } else {
    cacheSuffix = 'full';
  }
  const cacheKey = `${datasetKey}:${slot}:${cacheSuffix}`;

  // 3) Build the connector + dialect maps the agent's userMessage needs.
  const connectorsByName = new Map<string, NodeConnector>();
  const dialectsByName = new Map<string, string>();
  for (const entry of connections ?? []) {
    if (!entry.config) continue;
    const c = await getOrCreateBenchmarkConnector(
      entry.name, entry.dialect, entry.config, { datasetKey },
    );
    connectorsByName.set(entry.name, c);
    dialectsByName.set(entry.name, entry.dialect);
  }

  // 4) Catalog summary blob for the agent's userMessage. Question-agnostic
  //    so the cache slot is safe to share across rows.
  const fetchSample = makeFetchTableSample(effectiveSchema, statsByCol, connectorsByName, dialectsByName);
  const summary: CatalogSummary = await buildCatalogSummary(
    effectiveSchema, statsByCol, rowCountByTable, fetchSample,
  );
  const catalogSummaryText = renderCatalogSummary(summary);

  // 5) Cache lookup → dispatch on miss.
  let payloadPromise = autoContextStore.get(cacheKey);
  let toolCallId: string;
  if (payloadPromise) {
    // HIT: fresh toolCallId, no dispatch.
    toolCallId = gen_id();
  } else {
    // MISS: dispatch the agent. The same toolCallId is reused later when
    // we replace the in-toolThread pair with the rendered version in
    // threadHistory — keeps the synthesised pair internally consistent.
    toolCallId = gen_id();
    const dispatchToolCallId = toolCallId;
    payloadPromise = (async () => {
      const synthAssistant = buildSynthAssistant(dispatchToolCallId, catalogSummaryText);
      await orchestrator.dispatch(synthAssistant, parent);
      const payload = findFinishAutoContextPayload(orchestrator.log, dispatchToolCallId);
      if (!payload) {
        throw new Error('AutoContextAgent finished without calling FinishAutoContext');
      }
      return payload;
    })().catch((err) => {
      autoContextStore.delete(cacheKey);
      throw err;
    });
    autoContextStore.set(cacheKey, payloadPromise);
  }

  const payload = await payloadPromise;
  const rendered = renderAutoContextPayload(payload, maxChars);

  // 6) Splice the dispatch-pushed (synthAssistant, wrappedToolResult) pair
  //    out of parent.toolThread (no-op on cache hit, since dispatch didn't
  //    push anything). Log preserves the originals; we replace them in
  //    threadHistory with the rendered version below.
  for (let i = parent.toolThread.length - 1; i >= 0; i--) {
    const e = parent.toolThread[i];
    if ('role' in e && e.role === 'toolResult' && e.toolCallId === toolCallId) {
      parent.toolThread.splice(i, 1);
      continue;
    }
    if (
      'role' in e && e.role === 'assistant'
      && e.content.some((c) => c.type === 'toolCall' && c.id === toolCallId)
    ) {
      parent.toolThread.splice(i, 1);
    }
  }

  // 7) Inject the rendered pair into threadHistory so MXAgent.buildMessages
  //    places them BEFORE the user message.
  parent.threadHistory.push(
    buildSynthAssistant(toolCallId, catalogSummaryText),
    buildRenderedResult(toolCallId, rendered),
  );
}
