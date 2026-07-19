// Shared chat orchestration core — builds the orchestrator from a saved pi log
// (`setupOrchestration`), records LLM calls (`recordLlmCalls`), estimates next-turn
// context size (`estimateNextChatContext`), and exposes the tool/agent registries
// (`REGISTRABLES` / `HEADLESS_REGISTRABLES`). Consumed by the v3 turn runner
// (`lib/chat/conversation-turn.server.ts`) for ALL chat — browser (Explore/side-chat/
// onboarding) AND headless callers with no client to bridge tool calls back to
// (Slack — see `lib/integrations/slack/process-event.ts`). Translates a legacy
// ChatRequest into an orchestrator message/resume via `lib/chat-translator`.

import 'server-only';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { creditEnforcer } from '@/lib/analytics/credit-usage.server';
import { buildLlmPlanResolver } from '@/lib/llm/llm-plan.server';
import type {
  ConversationLog,
  ConversationLogEntry as PiLogEntry,
  RegistrableClass,
} from '@/orchestrator/types';
import {
  WebAnalystAgent,
  EditFile,
  CreateFile,
  DetachViz,
  ReadFiles,
  Navigate,
  ReviewFile,
  Screenshot,
  ClarifyFrontend,
  PublishAll,
  LoadSkill,
  LoadContext,
} from '@/agents/web-analyst/web-analyst';
import { SearchFiles, ReadFiles as ServerReadFiles } from '@/agents/analyst/file-tools';
import { CheckFileHealth } from '@/agents/analyst/health-tools';
import { SlackAgent } from '@/agents/slack/slack-agent';
import { OnboardingContextAgent, OnboardingDashboardAgent } from '@/agents/onboarding/onboarding-agents';
import { ListDBConnections } from '@/agents/benchmark-analyst/db-tools';
import { CatalogSearchDBSchema, ChainedExecuteQuery } from '@/agents/benchmark-analyst/db-tools';
import { FetchHandleV2 } from '@/agents/benchmark-analyst/v2/fetch-handle';
import { SearchDBSchema, ExecuteQuery, FuzzyMatch } from '@/agents/benchmark-analyst/db-tools.server';
import { BenchmarkAnalystAgent } from '@/agents/benchmark-analyst/benchmark-analyst';
import {
  DoubleCheckBenchmarkAgent,
  CheckEquivalence,
} from '@/agents/benchmark-analyst/double-check-benchmark';
import {
  V2BenchmarkAnalystAgent,
  V2DoubleCheckBenchmarkAgent,
  V2_DATA_TOOLS,
} from '@/agents/benchmark-analyst/v2';
import type { BenchmarkAnalystContext, ConnectionInfo } from '@/agents/benchmark-analyst/types';
import {
  loadBenchmarkConnectionsFromEnv,
  type BenchmarkConnectionEntry,
} from '@/agents/benchmark-analyst/connection-source';
import { RemoteAnalystAgent } from '@/agents/analyst/analyst-agent';
import { RemoteSessionAgent } from '@/agents/remote-session/remote-session-agent';
import type { RemoteAnalystContext } from '@/agents/analyst/types';
import { getPageType } from '@/agents/analyst/skills';
import { normalizeAttachments } from '@/lib/chat/attachments.server';
import type { AgentSkillSelection, AgentUserSkillCatalogItem } from '@/lib/types';
import { buildServerAgentArgs } from '@/lib/chat/agent-args.server';
import { listAllConnections } from '@/lib/data/connections.server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import {
  legacyToolResultToPi,
} from '@/lib/chat-translator';
import { getConversation as getV3Conversation, loadLog as loadV3Log } from '@/lib/data/conversations.server';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import { recordLlmRequest, recordLlmResponse, recordLlmCallEvent } from '@/lib/analytics/file-analytics.db';
import { UNKNOWN_TRIGGER } from '@/lib/analytics/credits.types';
import { buildLlmCallDetail } from '@/lib/chat/headless-llm-tracking.server';
import { setLlmCallRecorder } from '@/orchestrator/llm';
import type { AssistantMessage } from '@/orchestrator/llm';
import type { LLMCallDetail } from '@/lib/chat/chat-types';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import type {
  ChatRequest,
  CompletedToolCallResult,
} from '@/lib/chat/chat-types';
import { estimateContextSize, type ContextSizeEstimate } from '@/lib/chat/context-size-estimate';
import type { ChatModelSelection } from '@/lib/llm/llm-config-types';


import { immutableSet, immutableMap } from '@/lib/utils/immutable-collections';
import type { MXAgent } from '@/orchestrator/types';

// Persist each LLM call's pi-format request the moment it's made; the response
// is filled into the same row after the turn (see recordLlmCalls), and a failed
// call's error is written here (the engine discards the failed message, so it's
// only available at the boundary). Registered once — headless / benchmark runs
// don't import this module, so they don't log.
setLlmCallRecorder({
  recordRequest: (callId, request) => { void recordLlmRequest(callId, JSON.stringify(request)); },
  recordError: (callId, errorMessage, responseJson) => {
    void recordLlmResponse({ callId, responseJson, error: errorMessage });
  },
});

/**
 * Default registrables for production chat. The DB tools here (`ExecuteQuery`,
 * `SearchDBSchema`) are the *production* variants — `ExecuteQuery.run()`
 * routes via `runQuery` → `ConnectionsAPI.getRawByName`, and
 * `SearchDBSchema.run()` routes via `loadConnectionSchema` →
 * `FilesAPI.loadFileByPath`. For benchmark conversations (root invocation
 * name = `'BenchmarkAnalystAgent'` or `'DoubleCheckBenchmarkAgent'`) we
 * swap them for `Base*` variants via `BENCHMARK_TOOL_SWAPS` below — same
 * `schema.name`, different `run()`, registers from
 * `ctx.connections[*].config`.
 */
export const REGISTRABLES: RegistrableClass[] = [
  SearchDBSchema,
  ExecuteQuery,
  FuzzyMatch,
  ReadFiles,
  SearchFiles,
  CheckFileHealth,
  EditFile,
  CreateFile,
  DetachViz,
  Navigate,
  ReviewFile,
  Screenshot, // legacy alias of ReviewFile — old conversation logs still resolve it
  ClarifyFrontend,
  PublishAll,
  LoadSkill,
  LoadContext,
  WebAnalystAgent,
  // Slack chat runs headlessly through the same shared turn runner (setupOrchestration
  // picks SlackAgent as root when body.agent === 'SlackAgent' — see below). SlackAgent
  // extends RemoteAnalystAgent and advertises ListDBConnections (which WebAnalystAgent
  // drops), so both must be registered for the orchestrator to instantiate them on a
  // new turn or when reconstructing a saved Slack log.
  SlackAgent,
  ListDBConnections,
  // Onboarding-wizard agents (connection setup): run on the chat path with the
  // frontend bridge (EditFile/CreateFile). Registered so the orchestrator can
  // reconstruct them on resume after a bridged tool completes.
  OnboardingContextAgent,
  OnboardingDashboardAgent,
  // Lets the orchestrator resume / reconstruct benchmark conversations
  // (root invocation name is `'BenchmarkAnalystAgent'` for single-agent
  // benchmark runs, or `'DoubleCheckBenchmarkAgent'` for cross-check runs)
  // in chat. `CheckEquivalence` is the judge tool dispatched by the
  // DoubleCheck controller.
  BenchmarkAnalystAgent,
  DoubleCheckBenchmarkAgent,
  CheckEquivalence,
  // The new V1 chained tools — registered so saved V1 benchmark logs
  // resume against the post-port behavior. FetchHandleV2 is shared with V2.
  FetchHandleV2,
  // Remote Agent Sessions: the session root invocation (`name: 'RemoteSessionAgent'`) must be
  // reconstructable both by the remote dispatch driver and by any later NORMAL turn loading a log
  // that contains a past remote session. Never run() as an LLM loop.
  RemoteSessionAgent,
];

/**
 * For each registrable whose `schema.name` matches, swap in the override
 * class. Used to register the V1-benchmark tool variants in place of
 * production ones when the conversation root is `BenchmarkAnalystAgent`.
 * (Both classes use `schema.name = 'ExecuteQuery' / 'SearchDBSchema'`.)
 */
const BENCHMARK_TOOL_SWAPS: Record<string, RegistrableClass> = {
  ExecuteQuery: ChainedExecuteQuery,
  SearchDBSchema: CatalogSearchDBSchema,
};

/**
 * Headless (clientless) tool swaps. `REGISTRABLES` registers the WebAnalystAgent
 * `ReadFiles` — a frontend-bridge variant that throws `UserInputException` so the
 * browser can read in-flight Redux state. There is no browser in the headless path
 * (Slack / reports / eval), so that variant hangs as a dangling pending tool and
 * gets marked "interrupted", leaving the agent unable to finish. Swap in the
 * server-side `ReadFiles` (reads the document DB directly) for those runs.
 */
const HEADLESS_TOOL_SWAPS: Record<string, RegistrableClass> = {
  ReadFiles: ServerReadFiles,
};

/**
 * V2 benchmark registrables. The V2 agent has a different toolset (4
 * primitives, handle-based) so a swap-on-name approach doesn't cover it —
 * we replace the whole array. Both the single-agent (`V2BenchmarkAnalystAgent`)
 * and double-check (`V2DoubleCheckBenchmarkAgent`) entry points are
 * registered alongside `CheckEquivalence` so resume + new-message paths
 * both work, regardless of whether the saved log was a V2 single or V2
 * double-check run.
 */
const V2_BENCHMARK_REGISTRABLES: RegistrableClass[] = [
  ...V2_DATA_TOOLS,
  V2BenchmarkAnalystAgent,
  V2DoubleCheckBenchmarkAgent,
  CheckEquivalence,
];

/**
 * V1 and V2 double-check both inherit `schema.name = 'DoubleCheckBenchmarkAgent'`,
 * so the root name alone can't tell them apart. We treat the conversation as
 * V2 when the saved log contains any entry whose `name` is a V2-only marker —
 * the agent class name `V2BenchmarkAnalystAgent`, or one of the V2-exclusive
 * tool names (`Explore`, `fetchHandle`).
 */
const V2_AGENT_MARKERS = immutableSet(['V2BenchmarkAnalystAgent', 'Explore', 'fetchHandle']);

export function isV2BenchmarkConversation(log: ConversationLog): boolean {
  for (const entry of log) {
    const e = entry as { type?: string; name?: string };
    if ((e.type === 'toolCall' || e.type === 'toolResult') && e.name && V2_AGENT_MARKERS.has(e.name)) {
      return true;
    }
  }
  return false;
}

function toolName(cls: RegistrableClass): string {
  return (cls as { schema?: { name?: string } }).schema?.name ?? '';
}

function withSwaps(
  base: RegistrableClass[],
  swaps: Record<string, RegistrableClass>,
): RegistrableClass[] {
  return base.map((cls) => swaps[toolName(cls)] ?? cls);
}

/**
 * Registrables for headless (clientless) orchestration — Slack, reports, eval,
 * feed-summary. Identical to `REGISTRABLES` except frontend-bridge tools that
 * require a browser are swapped for server-side equivalents (see
 * `HEADLESS_TOOL_SWAPS`). Use this instead of `REGISTRABLES` in any runner
 * that has no client to bridge tool calls back to.
 */
export const HEADLESS_REGISTRABLES: RegistrableClass[] = withSwaps(
  REGISTRABLES,
  HEADLESS_TOOL_SWAPS,
);

/** Subset of legacy ChatResponse the chat orchestration path produces. */
export interface OrchestrationSetup {
  conversationId: number;
  expectedLogIndex: number;
  orchestrator: Orchestrator;
  rawStream: ReturnType<Orchestrator['run']> | null;
  rootAgent?: MXAgent;
  fatalError?: string;
  /** Surface the turn ran on (explore/question/dashboard/…) — recorded as the LLM-call `trigger`. */
  pageType?: string | null;
}

/**
 * Return the root invocation's agent name from a saved orchestrator conversation
 * log, or undefined if the log has no root. The root is the first
 * AgentInvocation entry with `parent_id === null`. setupOrchestration uses
 * this to pick which agent class to instantiate for a new user-message
 * turn — `BenchmarkAnalystAgent` for benchmark conversations,
 * `WebAnalystAgent` for production conversations.
 */
export function getRootAgentName(log: ConversationLog): string | undefined {
  for (const entry of log) {
    const e = entry as { type?: string; parent_id?: string | null; name?: string };
    if (e.type === 'toolCall' && e.parent_id === null) return e.name;
  }
  return undefined;
}

/**
 * Reconstruct a `BenchmarkAnalystContext` from a saved benchmark
 * conversation log. The runner stored connections + whitelist on the
 * root invocation's `context`; we read them back here so chat
 * continuation can reseed the agent with the same per-row state.
 *
 * Configs may be present on `ctx.connections[*].config` (the new shape)
 * so the `Base*` DB tools can build NodeConnectors at run-time.
 */
export function buildBenchmarkContextFromSavedLog(log: ConversationLog): BenchmarkAnalystContext {
  for (const entry of log) {
    const e = entry as {
      type?: string;
      parent_id?: string | null;
      context?: Record<string, unknown>;
    };
    if (e.type !== 'toolCall' || e.parent_id !== null) continue;
    const ctx = (e.context ?? {}) as Partial<BenchmarkAnalystContext>;
    return {
      connections: ctx.connections,
      whitelistedTables: ctx.whitelistedTables,
      contextDocs: ctx.contextDocs,
    };
  }
  return {};
}

/**
 * Root agent class selected by the request's `agent` name for a NEW production
 * (non-benchmark) turn. Production chat sends `AnalystAgent`/`WebAnalystAgent`
 * (→ WebAnalystAgent); the onboarding wizard sends its specialized agents; the
 * headless Slack runner (which controls `body.agent` itself, never client-supplied)
 * sends `SlackAgent`. Any unknown/absent name falls back to WebAnalystAgent. (On
 * resume the orchestrator reconstructs the root from the saved log via the
 * registrables, not this map — but Slack re-sends `agent: 'SlackAgent'` on every
 * turn anyway, same as the browser resends its own agent name.)
 *
 * Return type is the common `RemoteAnalystAgent` ancestor (not `WebAnalystAgent`)
 * so `SlackAgent` — which extends `RemoteAnalystAgent` directly, not
 * `WebAnalystAgent` — is a valid map value alongside the WebAnalystAgent-derived
 * onboarding agents.
 */
type RootAgentCtor = new (
  orch: Orchestrator,
  params: { userMessage: string },
  context: RemoteAnalystContext,
) => RemoteAnalystAgent;

// A Map (not a plain object) so a user-controlled `body.agent` can't reach
// inherited keys like `constructor`/`__proto__` (CodeQL: unvalidated dynamic
// method call). Unknown names → undefined → WebAnalystAgent fallback.
const ROOT_AGENT_BY_NAME = immutableMap<string, RootAgentCtor>([
  ['WebAnalystAgent', WebAnalystAgent],
  ['AnalystAgent', WebAnalystAgent],
  ['OnboardingContextAgent', OnboardingContextAgent],
  ['OnboardingDashboardAgent', OnboardingDashboardAgent],
  ['SlackAgent', SlackAgent],
]);

export async function setupOrchestration(
  body: ChatRequest,
  user: EffectiveUser,
  conversationId: number,
  options: { preview?: boolean; savedLog: ConversationLog; fileMeta?: Record<string, unknown> | null },
): Promise<OrchestrationSetup> {
  // Conversations are v3-only: callers inject the saved pi log from the `messages` rows via
  // options.savedLog so this whole agent/context build is reused without any conversation FILE.
  const savedLog: ConversationLog = options.savedLog;
  const fileMeta: Record<string, unknown> | null = options.fileMeta ?? null;
  const expectedLogIndex = savedLog.length;

  const narrowedMode: 'org' | 'tutorial' = user.mode === 'tutorial' ? 'tutorial' : 'org';

  const agentArgs = body.agent_args ?? {};
  const contextFileId =
    typeof (agentArgs as { context_file_id?: number }).context_file_id === 'number'
      ? (agentArgs as { context_file_id: number }).context_file_id
      : undefined;
  const contextVersion =
    typeof (agentArgs as { context_version?: number }).context_version === 'number'
      ? (agentArgs as { context_version: number }).context_version
      : undefined;
  const requestedConnectionId =
    typeof (agentArgs as { connection_id?: unknown }).connection_id === 'string'
      ? (agentArgs as { connection_id: string }).connection_id
      : undefined;
  const rawModelOverride = (agentArgs as { model_override?: unknown }).model_override;
  const modelOverride: ChatModelSelection | undefined = rawModelOverride
    && typeof rawModelOverride === 'object'
    && typeof (rawModelOverride as { providerName?: unknown }).providerName === 'string'
    && ((rawModelOverride as { model?: unknown }).model === undefined
      || typeof (rawModelOverride as { model?: unknown }).model === 'string')
      ? {
          providerName: (rawModelOverride as { providerName: string }).providerName,
          ...((rawModelOverride as { model?: string }).model
            ? { model: (rawModelOverride as { model: string }).model }
            : {}),
        }
      : undefined;

  // The client sends only POINTERS (context_file_id, context_version,
  // connection_id) — the server resolves the actual context docs, catalog,
  // library, and schema from the DB here. This is the single source of truth:
  // the same resolveContextDocs / getWhitelistedSchemaForUser the docs sidebar
  // uses, so the prompt and the UI can never disagree, and the browser can't
  // inject context it didn't earn. (Clientless callers — Slack, report jobs —
  // call buildServerAgentArgs directly and never reach this chat path.)
  const serverArgs = await buildServerAgentArgs(user, {
    contextFileId,
    contextVersion,
    connectionId: requestedConnectionId,
  });

  const clientAllowedVizTypes = Array.isArray((agentArgs as { allowed_viz_types?: unknown }).allowed_viz_types)
    ? (agentArgs as { allowed_viz_types: string[] }).allowed_viz_types
    : undefined;
  const clientAgentName =
    typeof (agentArgs as { agent_name?: unknown }).agent_name === 'string'
      ? (agentArgs as { agent_name: string }).agent_name
      : undefined;
  // Skills: client sends agent_args.skills.{selected, user_catalog} and
  // unrestricted_mode. Page type is derived from
  // agent_args.app_state for skill preloading — kept separate from the
  // (intentionally null) <AppState> user-message block.
  const clientSkills = (agentArgs as { skills?: unknown }).skills as
    | { selected?: unknown; user_catalog?: unknown }
    | undefined;
  const selectedSkills = Array.isArray(clientSkills?.selected)
    ? (clientSkills!.selected as AgentSkillSelection[])
    : [];
  const userSkillCatalog = Array.isArray(clientSkills?.user_catalog)
    ? (clientSkills!.user_catalog as AgentUserSkillCatalogItem[])
    : [];
  const unrestrictedMode = (agentArgs as { unrestricted_mode?: unknown }).unrestricted_mode === true;
  const clientCity = typeof (agentArgs as { city?: unknown }).city === 'string'
    ? (agentArgs as { city: string }).city
    : undefined;
  const clientAppState = (agentArgs as { app_state?: unknown }).app_state;
  // Scroll pointer computed client-side at send (needs the DOM's scroll position + view height) —
  // threaded onto the agent context like app_state, rendered as <Viewport> by the projection pass.
  const clientViewport = (agentArgs as { viewport?: string }).viewport;
  const pageType = getPageType(clientAppState);
  // Attachments: v2 sends images inline as base64 data: URLs (no upload), so we
  // just parse them; text passes through. Remote URLs are ignored (no fetch).
  const attachments = normalizeAttachments((agentArgs as { attachments?: unknown }).attachments);
  const schemaForWhitelist = serverArgs.schema;
  const whitelistedTables: string[] = [];
  for (const s of schemaForWhitelist) {
    for (const t of s.tables) {
      whitelistedTables.push(t);
      whitelistedTables.push(`${s.schema}.${t}`);
    }
  }
  // Branch on the saved log's root agent. Benchmark conversations
  // (imported from `npm run benchmark:dab` output) continue with
  // BenchmarkAnalystAgent + a minimal BenchmarkAnalystContext seeded from
  // the saved root entry's connections. All other conversations use the
  // production WebAnalystAgent path.
  // A benchmark conversation's saved log has either single-agent
  // (`BenchmarkAnalystAgent`) or cross-check (`DoubleCheckBenchmarkAgent`)
  // root. Both share the same per-conversation context model
  // (`meta.benchmark_connections` carrying full configs) and should
  // continue with the benchmark `Base*` DB tool variants — not the
  // production `runQuery`/`loadConnectionSchema` path.
  const rootName = getRootAgentName(savedLog);
  const isBenchmarkRoot = rootName === 'BenchmarkAnalystAgent' || rootName === 'DoubleCheckBenchmarkAgent';
  // V1 and V2 double-check share the root name `DoubleCheckBenchmarkAgent`;
  // disambiguate by scanning the log for V2-only markers (V2 agent name or
  // V2-exclusive tools).
  const isV2Bench = isBenchmarkRoot && isV2BenchmarkConversation(savedLog);
  // Slack (headless, no browser to bridge frontend-only tools to) — detected from
  // either the request's own `agent` (the Slack runner sends this on every turn,
  // trusted since it's server-controlled, never client input) or the saved log's
  // root (defensive, for resume paths that omit `body.agent`).
  const isSlackRoot = body.agent === 'SlackAgent' || rootName === 'SlackAgent';

  // V2 benchmark conversations get the V2 toolset + V2 agent classes; V1
  // benchmark conversations get the `Base*` tool swaps on the production
  // registrables; Slack (headless) swaps frontend-bridge tools (ReadFiles) for
  // server equivalents (see HEADLESS_TOOL_SWAPS); production conversations get
  // the default registrables.
  const registrables = isV2Bench
    ? V2_BENCHMARK_REGISTRABLES
    : isBenchmarkRoot
      ? withSwaps(REGISTRABLES, BENCHMARK_TOOL_SWAPS)
      : isSlackRoot
        ? HEADLESS_REGISTRABLES
        : REGISTRABLES;
  const orch = new Orchestrator(registrables, [...savedLog]);
  // Enforce per-user credit limits deep at the LLM call site (no-op unless
  // ENFORCE_CREDIT_LIMITS). Covers every agent/sub-agent/resume hop in this run.
  orch.beforeLlmCall = creditEnforcer(user);
  // DB-backed model config (workspace-level — every mode shares the org
  // config's `llm` providers): resolve the per-use-case model chain on every
  // call; unconfigured workspaces default to the MinusX gateway.
  orch.resolveLlmPlan = buildLlmPlanResolver(modelOverride);

  // Resume path: frontend sends back [ToolCall, ToolMessage][] tuples.
  // ToolMessage (from Redux/executeToolCall) lacks .function — patch it from
  // tuple[0] (the original ToolCall) so legacyToolResultToPi can read .function.name.
  if (body.completed_tool_calls && body.completed_tool_calls.length > 0) {
    const piResults = body.completed_tool_calls.map((tuple) => {
      const toolCall = tuple[0];
      const result = tuple[1] as unknown as CompletedToolCallResult;
      const patched: CompletedToolCallResult = {
        ...result as unknown as CompletedToolCallResult,
        run_id: (result as unknown as { run_id?: string }).run_id ?? '',
        function: toolCall.function,
      };
      return legacyToolResultToPi(patched);
    });
    return {
      conversationId,
      expectedLogIndex,
      orchestrator: orch,
      rawStream: orch.resume(piResults),
      pageType,
    };
  }

  if (body.user_message) {
    if (isBenchmarkRoot) {
      // Per-conversation connector configs come from the conversation
      // file's `meta.benchmark_connections` (set at import time when the
      // user dropped a connections.json alongside the JSONL); falling
      // back to `BENCHMARK_CONNECTIONS_CONFIG` env so dev workflows that
      // pre-set the env still work. The `Base*` DB tools registered for
      // this orchestrator build NodeConnectors from `ctx.connections[*].config`
      // at run-time, so we just need to make sure those entries are
      // populated here (with full config, not just metadata).
      const baseBenchCtx = buildBenchmarkContextFromSavedLog(savedLog);
      const allowedNames = new Set((baseBenchCtx.connections ?? []).map((c) => c.name));
      const persistedConnections = fileMeta?.benchmark_connections;
      const entries: BenchmarkConnectionEntry[] = Array.isArray(persistedConnections)
        ? (persistedConnections as BenchmarkConnectionEntry[])
        : loadBenchmarkConnectionsFromEnv();
      // Restrict configs to the agent's allowed connection set (saved-log
      // root carries the per-row allowlist); names outside it stay
      // metadata-only so they can't be queried even by name collision.
      // `BenchmarkConnectionEntry[]` is directly assignable to
      // `ConnectionInfo[]` (narrower→wider on the `config` field).
      const fullConnections: ConnectionInfo[] = entries.filter((e) => allowedNames.has(e.name));
      const benchCtx: BenchmarkAnalystContext & { effectiveUser: EffectiveUser } = {
        ...baseBenchCtx,
        connections: fullConnections.length > 0 ? fullConnections : baseBenchCtx.connections,
        effectiveUser: user,
      };
      const BenchAgent = isV2Bench ? V2BenchmarkAnalystAgent : BenchmarkAnalystAgent;
      const agent = new BenchAgent(orch, { userMessage: body.user_message }, benchCtx);
      return {
        conversationId,
        expectedLogIndex,
        orchestrator: orch,
        rootAgent: agent,
        rawStream: options?.preview ? null : orch.run(agent),
        pageType,
      };
    }
    // Slack must discover connections itself (it has ListDBConnections + no
    // client-selected connection_id) — unlike browser chat, which already knows
    // the connection from Redux and never registers that tool. Only fetched for
    // the Slack root so the hot browser-turn path pays no extra query.
    const connections: ConnectionInfo[] | undefined = isSlackRoot
      ? (await listAllConnections(user)).connections.map((c) => ({
          name: c.name,
          dialect: c.type,
          config: c.config,
        }))
      : undefined;
    const ctx: RemoteAnalystContext = {
      userId: String(user.userId ?? user.email),
      mode: narrowedMode,
      effectiveUser: user,
      connectionId: serverArgs.connection_id,
      connections,
      whitelistedTables: whitelistedTables.length > 0 ? whitelistedTables : undefined,
      // Context docs (structure) and schema are server-resolved from the request's
      // pointers (see buildServerAgentArgs above) — never taken from the client
      // payload. The agent renders the whole Context section from this one object.
      resolvedContextDocs: serverArgs.context_docs,
      annotations: serverArgs.annotations,
      allowedVizTypes: clientAllowedVizTypes,
      schema: serverArgs.schema,
      homeFolder: resolveHomeFolderSync(user.mode, user.home_folder || ''),
      role: user.role,
      agentName: clientAgentName,
      appState: clientAppState,
      viewport: clientViewport,
      pageType,
      selectedSkills,
      userSkillCatalog,
      unrestrictedMode,
      attachments,
      city: clientCity,
    };
    const RootAgent = (body.agent && ROOT_AGENT_BY_NAME.get(body.agent)) || WebAnalystAgent;
    const agent = new RootAgent(orch, { userMessage: body.user_message }, ctx);
    return {
      conversationId,
      expectedLogIndex,
      orchestrator: orch,
      rootAgent: agent,
      rawStream: options?.preview ? null : orch.run(agent),
      pageType,
    };
  }

  return {
    conversationId,
    expectedLogIndex,
    orchestrator: orch,
    rawStream: null,
    fatalError: 'v=2 chat: must supply either `user_message` or `completed_tool_calls`',
  };
}

export async function estimateNextChatContext(
  body: ChatRequest,
  user: EffectiveUser,
  conversationId: number,
): Promise<ContextSizeEstimate> {
  const bodyWithProbe: ChatRequest = {
    ...body,
    user_message: body.user_message?.length ? body.user_message : ' ',
    completed_tool_calls: undefined,
    resume: undefined,
  };
  // Conversations live in dedicated tables (v3-only) — feed the log from rows.
  const v3 = await getV3Conversation(conversationId);
  if (!v3) throw new Error(`Conversation ${conversationId} not found`);
  const savedLog = await loadV3Log(conversationId);
  const setup = await setupOrchestration(bodyWithProbe, user, conversationId, {
    preview: true,
    savedLog,
    fileMeta: v3.meta ?? null,
  });
  if (setup.fatalError) {
    throw new Error(setup.fatalError);
  }
  if (!setup.rootAgent) {
    throw new Error('Unable to build next chat context');
  }
  const context = setup.orchestrator.previewRootContext(setup.rootAgent);
  return estimateContextSize(context);
}

/**
 * Record this turn's LLM calls out-of-band, from the turn's new log entries:
 * write per-call stats to `llm_call_events` and fill the response into the
 * `llm_logs` row whose request was already written when the call was made
 * (LOCAL only — never forwarded), then publish `AppEvents.LLM_CALL` for the
 * best-effort central stats forward. The call id + duration are the ones the
 * engine already stamps onto each message. Best-effort.
 */
export async function recordLlmCalls(piDiff: PiLogEntry[], conversationId: number, user: EffectiveUser, source?: string | null): Promise<void> {
  try {
    const userId = typeof user.userId === 'number' ? user.userId : null;
    const llmCalls: Record<string, LLMCallDetail> = {};
    for (const entry of piDiff) {
      const msg = entry as unknown as AssistantMessage;
      const built = buildLlmCallDetail(msg);
      if (!built) continue;
      const { callId, detail } = built;
      llmCalls[callId] = detail;

      // LOCAL writes are AWAITED so they persist before the handler returns
      // (a standalone prod build won't keep fire-and-forget promises alive).
      await recordLlmCallEvent({
        conversationId,
        llmCallId: callId,
        provider: detail.provider,
        model: detail.model,
        mode: user.mode,
        totalTokens: detail.total_tokens,
        promptTokens: detail.prompt_tokens,
        completionTokens: detail.completion_tokens,
        cachedTokens: detail.cached_tokens,
        cacheCreationTokens: detail.cache_creation_tokens,
        cost: detail.cost,
        durationS: detail.duration,
        stream: true,
        finishReason: detail.finish_reason,
        // Never empty — a conversation surface (explore/question/…), else 'unknown'.
        trigger: source && source.length > 0 ? source : UNKNOWN_TRIGGER,
        userId,
      });

      // The request row was written when the call was made; fill in the
      // response (or the error message + error column for a failed call).
      await recordLlmResponse({
        callId,
        userId,
        provider: msg.provider,
        model: msg.model,
        responseJson: JSON.stringify(msg),
        error: msg.stopReason === 'error' ? (msg.errorMessage ?? 'error') : null,
      });
    }
    if (Object.keys(llmCalls).length === 0) return;
    // Best-effort central forward (stats → mx-llm-provider via notifyAppEvent).
    appEventRegistry.publish(AppEvents.LLM_CALL, {
      mode: user.mode,
      conversationId,
      llmCalls,
      userId: userId ?? undefined,
      userEmail: user.email,
      userRole: user.role,
    });
  } catch (e) {
    console.error('[v2/chat] failed to record LLM calls:', e);
  }
}

// Headless usage tracking (feed-summary, micro-tasks, …) lives in a leaf module so
// lightweight callers don't import this registrables hub. Re-exported for back-compat.
export { recordHeadlessLlmCalls } from '@/lib/chat/headless-llm-tracking.server';
