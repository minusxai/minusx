/**
 * AutoContext: orientation layer for BenchmarkAnalystAgent.
 *
 * The agent runs once per (datasetKey, slot), observes the catalog,
 * annotates non-self-evident columns + verified joins, and returns a
 * structured payload that we merge into the canonical catalog tree and
 * render as a single Markdown block under `<GeneratedContext>` in the
 * analyst's system prompt.
 *
 * Split by phase across this directory (each phase file's header has the
 * detail):
 *   - `catalog-render.ts` — catalog ID assignment + the ID-tagged catalog
 *     blob the agent reads as its `userMessage`.
 *   - `agent.ts` — the `AutoContextAgent` + its `SubmitSchemaInfo` finisher
 *     tool.
 *   - `generation.ts` — parse the agent's raw output, mechanically verify
 *     every claimed join, and render the final `<GeneratedContext>` Markdown.
 *
 * This file is the entry point: it composes those phases into the two
 * orchestration flows callers actually use —
 *   - `ensureAutoContext` — the cached, embedded-in-parent-agent path (keeps
 *     a process-wide cache keyed by `(datasetKey, slot)` and pushes a
 *     synthetic wrapper onto the parent's `toolThread` so
 *     `renderGeneratedContextFromToolThread` can re-render it every LLM
 *     call).
 *   - `runAutoContextForSlot` — the standalone pre-step used by the
 *     benchmark runner (its own `Orchestrator`, no cache, no parent
 *     toolThread).
 *
 * Re-exports every symbol the phase files define so existing imports of
 * `'../auto-context'` / `'@/agents/.../auto-context/auto-context'` keep
 * working unchanged.
 */
import 'server-only';

import type { AssistantMessage, Message, ToolResultMessage } from '@/orchestrator/llm';
import type { ColumnMeta, NodeConnector } from '@/lib/connections/base';
import type {
  MXAgent,
  ConversationLog,
  ConversationLogEntry,
  RegistrableClass,
} from '@/orchestrator/types';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { EMPTY_USAGE, gen_id } from '@/orchestrator/utils';
import type { BenchmarkAnalystContext, ConnectionInfo } from '../../types';
import { getOrCreateBenchmarkConnector } from '../../shared-duckdb';
import { getCatalogStore } from '../catalog';
import { catalogProjection } from './catalog-summary';
import { assignCatalogIds, renderCatalogForAgent, type IdMap } from './catalog-render';
import { AutoContextAgent } from './agent';
import {
  parseAnnotations,
  probeJoinUsingConnectors,
  renderGeneratedContext,
  verifyJoinsMechanically,
} from './generation';
import type { AutoContextPayload } from './agent';
import type { FlatColumn } from './schema';

export {
  // catalog-render.ts
  type ElementType,
  type CatalogId,
  type IdMap,
  assignCatalogIds,
  DEFAULT_CATALOG_RENDER_MAX_CHARS,
  renderCatalogForAgent,
} from './catalog-render';

export {
  // agent.ts
  type Annotation,
  type AutoContextPayload,
  SubmitSchemaInfo,
  AutoContextAgent,
} from './agent';

export {
  // generation.ts
  parseAnnotations,
  type JoinEndpoint,
  type JoinProbe,
  verifyJoinsMechanically,
  DEFAULT_GENERATED_CONTEXT_MAX_CHARS,
  renderGeneratedContext,
} from './generation';

// ─── ensureAutoContext orchestration + cache ─────────────────────────────────

/** Full state the system-prompt renderer needs to reconstruct the rendered
 *  block on every analyst LLM call. Stored on the wrapper's `details`
 *  field — never serialized to the LLM. */
export interface AutoContextWrapperDetails {
  type: 'auto_context_render_state';
  schema: FlatColumn[];
  statsEntries: Array<[string, ColumnMeta]>;
  rowCountEntries: Array<[string, number]>;
  payload: AutoContextPayload;
}

/** What we cache process-wide per `(datasetKey, slot)` after a successful
 *  agent run + verification. Stores the agent's payload + the catalog
 *  snapshot it was built against so cache-hit rows can reconstruct the
 *  same render. */
interface CachedState {
  schema: FlatColumn[];
  statsByCol: Map<string, ColumnMeta>;
  rowCountByTable: Map<string, number>;
  payload: AutoContextPayload;
}

// eslint-disable-next-line no-restricted-syntax -- process-wide cache; race-locked via in-flight Promise pattern
const autoContextStore = new Map<string, Promise<CachedState>>();

/** Synth assistant turn announcing the AutoContextAgent invocation. The
 *  `userMessage` arg carries the rendered catalog for the agent to read. */
function buildSynthAssistant(toolCallId: string, userMessage: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{
      type: 'toolCall',
      id: toolCallId,
      name: AutoContextAgent.schema.name,
      arguments: { userMessage },
    }],
    api: 'controller' as never,
    provider: 'controller',
    model: 'controller',
    usage: EMPTY_USAGE,
    stopReason: 'toolUse',
    timestamp: Date.now(),
  };
}

/** Build the wrapper toolResult that the parent's `toolThread` will carry. */
function buildWrapperToolResult(
  toolCallId: string,
  state: CachedState,
): ToolResultMessage {
  const idMap = assignCatalogIds(state.schema);
  const rendered = renderGeneratedContext(
    state.schema, idMap, state.statsByCol, state.rowCountByTable, state.payload,
  );
  return {
    role: 'toolResult',
    toolCallId,
    toolName: AutoContextAgent.schema.name,
    content: [
      { type: 'text', text: rendered },
    ],
    isError: false,
    details: {
      type: 'auto_context_render_state',
      schema: state.schema,
      statsEntries: [...state.statsByCol.entries()],
      rowCountEntries: [...state.rowCountByTable.entries()],
      payload: state.payload,
    } as AutoContextWrapperDetails,
    timestamp: Date.now(),
  };
}

/**
 * Ensure that `parent.toolThread` has an AutoContextAgent wrapper carrying
 * verified annotations for the current `(datasetKey, slot)`. The wrapper's
 * `details.payload` lets the parent's `getSystemPrompt()` render the
 * `<GeneratedContext>` block on every LLM call.
 *
 * Cache miss: dispatches `AutoContextAgent` via `parent.orchestrator`,
 * parses + verifies its output, caches the result, and pushes the wrapper.
 *
 * Cache hit: skips dispatch and pushes a synthetic wrapper built from the
 * cached state. Either way, the parent's toolThread looks the same after
 * this returns.
 *
 * Race-locked via the in-flight Promise pattern: concurrent rows for the
 * same key share a single dispatch.
 */
export async function ensureAutoContext(parent: MXAgent): Promise<void> {
  const ctx = parent.context as BenchmarkAnalystContext;
  if (!ctx.datasetKey) return; // production paths skip
  const slot = ctx.catalogKey ?? 'default';
  const connections = ctx.connections ?? [];
  if (connections.length === 0) return;

  // `parent.orchestrator` is protected on the MXTool base class but every
  // MXAgent instance has it at runtime — read structurally rather than
  // pass it explicitly to keep the call site `ensureAutoContext(this)`.
  const orchestrator = (parent as unknown as { orchestrator: Orchestrator }).orchestrator;

  // Catalog read (cached at the catalog layer per dataset+slot).
  const catalogCacheKey = `auto-${slot}`;
  const { catalog } = await getCatalogStore(connections, catalogCacheKey, undefined, ctx.datasetKey);
  const { schema, statsByCol, rowCountByTable } = catalogProjection(catalog);
  if (schema.length === 0) return;

  const cacheKey = `${ctx.datasetKey}:${slot}:full`;
  let statePromise = autoContextStore.get(cacheKey);
  if (!statePromise) {
    // MISS — race-lock by inserting the in-flight Promise BEFORE any await
    // beyond this point.
    statePromise = (async (): Promise<CachedState> => {
      const idMap = assignCatalogIds(schema);
      const catalogText = renderCatalogForAgent(schema, idMap, statsByCol, rowCountByTable);

      const dispatchId = gen_id();
      const synth = buildSynthAssistant(dispatchId, catalogText);

      // Dispatch the agent — wrapper lands in parent.toolThread naturally.
      // We splice it back off below; the cached wrapper (built from the
      // verified payload) is what the parent ultimately keeps.
      try {
        await orchestrator.dispatch(synth, parent);
      } finally {
        // Remove the agent's natural-dispatch wrapper from toolThread (we
        // build our own with the right shape below).
        spliceDispatchPair(parent.toolThread, dispatchId);
      }

      const log = orchestrator.log as ConversationLogEntry[];
      const parsed = parseAnnotations(log, dispatchId, idMap);
      if (!parsed) {
        throw new Error('AutoContextAgent did not produce a SubmitSchemaInfo result.');
      }

      // Build connectors once for join probing.
      const connectorsByName = new Map<string, NodeConnector>();
      for (const entry of connections) {
        if (!entry.config) continue;
        const c = await getOrCreateBenchmarkConnector(
          entry.name, entry.dialect, entry.config, { datasetKey: ctx.datasetKey },
        );
        connectorsByName.set(entry.name, c);
      }
      const verified = await verifyJoinsMechanically(
        parsed,
        idMap,
        (from, to) => probeJoinUsingConnectors(connectorsByName, from, to),
      );

      return { schema, statsByCol, rowCountByTable, payload: verified };
    })().catch((err) => {
      autoContextStore.delete(cacheKey);
      throw err;
    });
    autoContextStore.set(cacheKey, statePromise);
  }

  const state = await statePromise;
  // Push the wrapper onto parent.toolThread. We do this uniformly for both
  // cache-hit and cache-miss paths — on miss we already spliced the
  // dispatch's natural wrapper off, on hit dispatch never ran.
  const wrapperId = gen_id();
  parent.toolThread.push(buildSynthAssistant(wrapperId, '<cached AutoContext>'));
  const wrapper = buildWrapperToolResult(wrapperId, state);
  parent.toolThread.push(wrapper);

  // Stash the rendered text on the context so the runner can persist it as
  // `_autocontext.txt` for offline inspection.
  const renderedText = (wrapper.content as Array<{ type: string; text: string }>)[0]?.text;
  if (renderedText) ctx.autoContextRendered = renderedText;
}

/** Splice the (synth assistant, agent-wrapper toolResult) pair for `id` out
 *  of the parent's toolThread. The orchestrator's `log` keeps the
 *  immutable trace; this just trims the runtime state. */
function spliceDispatchPair(arr: Message[], id: string): void {
  for (let i = arr.length - 1; i >= 0; i--) {
    const m = arr[i];
    if ('role' in m && m.role === 'toolResult' && m.toolCallId === id) {
      arr.splice(i, 1);
      continue;
    }
    if (
      'role' in m && m.role === 'assistant' && Array.isArray(m.content)
      && m.content.some((c) => c.type === 'toolCall' && c.id === id)
    ) {
      arr.splice(i, 1);
    }
  }
}

/**
 * Find the AutoContext wrapper in `parent.toolThread` (pushed by
 * `ensureAutoContext`), reconstruct the catalog snapshot from its
 * `details`, and render the `<GeneratedContext>` Markdown block. Returns
 * `undefined` when no wrapper is present (e.g. `ensureAutoContext` didn't
 * fire on this row — production paths, build failures, etc.).
 *
 * `BenchmarkAnalystAgent.getSystemPrompt()` calls this every LLM iteration.
 * It's pure / deterministic; the render is rebuilt each call, but the
 * per-call cost is negligible (sub-millisecond for typical schemas).
 */
export function renderGeneratedContextFromToolThread(parent: MXAgent): string | undefined {
  const wrapper = parent.toolThread.find(
    (m) =>
      'role' in m &&
      m.role === 'toolResult' &&
      m.toolName === AutoContextAgent.schema.name,
  ) as ToolResultMessage | undefined;
  if (!wrapper) return undefined;
  const details = wrapper.details as AutoContextWrapperDetails | undefined;
  if (!details || details.type !== 'auto_context_render_state') return undefined;
  const { schema, statsEntries, rowCountEntries, payload } = details;
  if (!schema || schema.length === 0) return undefined;
  const idMap = assignCatalogIds(schema);
  return renderGeneratedContext(
    schema,
    idMap,
    new Map(statsEntries),
    new Map(rowCountEntries),
    payload,
  );
}

// ─── Standalone auto-context runner ──────────────────────────────────────────

/** Result of running auto-context for a single slot. */
export interface AutoContextRunResult {
  catalogKey: string;
  renderedText: string;
  log: ConversationLog;
  annotationCount: number;
}

/**
 * Run AutoContextAgent as a standalone pre-step (outside any analyst agent).
 * Creates its own Orchestrator, dispatches the agent, parses + verifies
 * annotations, and returns the rendered markdown + conversation log.
 *
 * This is the entry point for the benchmark runner's auto-context pre-step.
 * It reuses all existing machinery (catalog, parsing, join verification)
 * but doesn't touch any parent agent's toolThread.
 */
export async function runAutoContextForSlot(
  connections: ConnectionInfo[],
  datasetKey: string,
  catalogKey: string,
  registrables: RegistrableClass[],
  contextDocs?: string,
): Promise<AutoContextRunResult> {
  if (connections.length === 0) {
    throw new Error('No connections provided for auto-context.');
  }

  // 1. Catalog read (cached at the catalog layer per dataset+slot).
  const catalogCacheKey = `auto-${catalogKey}`;
  const { catalog } = await getCatalogStore(connections, catalogCacheKey, undefined, datasetKey);
  const { schema, statsByCol, rowCountByTable } = catalogProjection(catalog);
  if (schema.length === 0) {
    throw new Error('Empty schema — no columns to annotate.');
  }

  // 2. Prepare agent input.
  const idMap: IdMap = assignCatalogIds(schema);
  const catalogText = renderCatalogForAgent(schema, idMap, statsByCol, rowCountByTable);

  // 3. Run AutoContextAgent in its own Orchestrator. `contextDocs` carries
  //    the dataset documentation (incl. HINTS), which the prompt instructs
  //    the agent to read first — join semantics often live there.
  const orch = new Orchestrator(registrables);
  const ctx: BenchmarkAnalystContext = { connections, datasetKey, catalogKey, contextDocs };
  const agent = new AutoContextAgent(orch, { userMessage: catalogText }, ctx);

  const stream = orch.run(agent as unknown as MXAgent);
  for await (const _ of stream) { /* drain */ }
  await stream.result();

  const log = orch.log as ConversationLog;

  // 4. Parse annotations from the log. The agent is the root, so its tool
  //    results have `parent_id === agent.id`.
  const parsed = parseAnnotations(log as ConversationLogEntry[], agent.id, idMap);
  if (!parsed) {
    throw new Error('AutoContextAgent did not produce a SubmitSchemaInfo result.');
  }

  // 5. Build connectors for join verification.
  const connectorsByName = new Map<string, NodeConnector>();
  for (const entry of connections) {
    if (!entry.config) continue;
    const c = await getOrCreateBenchmarkConnector(
      entry.name, entry.dialect, entry.config, { datasetKey },
    );
    connectorsByName.set(entry.name, c);
  }
  const verified = await verifyJoinsMechanically(
    parsed,
    idMap,
    (from, to) => probeJoinUsingConnectors(connectorsByName, from, to),
  );

  // 6. Render final markdown.
  const renderedText = renderGeneratedContext(schema, idMap, statsByCol, rowCountByTable, verified);

  return {
    catalogKey,
    renderedText,
    log,
    annotationCount: verified.annotations.length,
  };
}
