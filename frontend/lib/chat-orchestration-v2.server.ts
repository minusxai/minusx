// V=2 chat orchestration — server-side bridge between the legacy /api/chat
// + /api/chat/stream routes and the orchestrator. Translates inputs
// (legacy ChatRequest → orchestrator message/resume) and outputs (orchestrator log +
// stream events → legacy ChatResponse + streaming_event SSE frames) so the
// frontend stays unchanged.
//
// The data-shape boundary lives entirely in this file plus
// `lib/chat-translator/index.ts`. No frontend code knows about the orchestrator log shape.

import 'server-only';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type {
  ConversationLog,
  ConversationLogEntry as PiLogEntry,
  PendingToolCall as PiPendingToolCall,
  RegistrableClass,
  StreamEvent,
} from '@/orchestrator/types';
import {
  WebAnalystAgent,
  EditFile,
  CreateFile,
  ReadFiles,
  Navigate,
  ClarifyFrontend,
  PublishAll,
  LoadSkill,
} from '@/agents/web-analyst/web-analyst';
import { SearchFiles } from '@/agents/analyst/file-tools';
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
import type { RemoteAnalystContext } from '@/agents/analyst/types';
import { getPageType } from '@/agents/analyst/skills';
import { normalizeAttachments } from '@/lib/chat/attachments.server';
import type { AgentSkillSelection, AgentUserSkillCatalogItem } from '@/lib/types';
import { FilesAPI } from '@/lib/data/files.server';
import { buildServerAgentArgs } from '@/lib/chat/agent-args.server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import {
  piLogToLegacy,
  piStreamEventToLegacy,
  legacyToolResultToPi,
} from '@/lib/chat-translator';
import { extractDebugMessages } from '@/lib/conversations-utils';
import { appendLogToConversation, truncateMessageForName, slugify, createNewConversation } from '@/lib/conversations';
import { resolvePath, resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { isV2ConversationFile, legacyLogToPi } from '@/lib/chat-translator';
import type {
  ChatRequest,
  CompletedToolCallFromPython,
} from '@/lib/chat-orchestration';
import type {
  ToolCall as LegacyToolCall,
  ConversationLogEntry as LegacyLogEntry,
  ConversationFileContent,
} from '@/lib/types';
import type { DebugMessage } from '@/store/chatSlice';
import { immutableSet, immutableMap } from '@/lib/utils/immutable-collections';

/**
 * Default v=2 registrables. The DB tools here (`ExecuteQuery`,
 * `SearchDBSchema`) are the *production* variants — `ExecuteQuery.run()`
 * routes via `runQuery` → `ConnectionsAPI.getRawByName`, and
 * `SearchDBSchema.run()` routes via `loadConnectionSchema` →
 * `FilesAPI.loadFileByPath`. For benchmark conversations (root invocation
 * name = `'BenchmarkAnalystAgent'` or `'DoubleCheckBenchmarkAgent'`) we
 * swap them for `Base*` variants via `BENCHMARK_TOOL_SWAPS` below — same
 * `schema.name`, different `run()`, registers from
 * `ctx.connections[*].config`.
 */
export const V2_REGISTRABLES: RegistrableClass[] = [
  SearchDBSchema,
  ExecuteQuery,
  FuzzyMatch,
  ReadFiles,
  SearchFiles,
  EditFile,
  CreateFile,
  Navigate,
  ClarifyFrontend,
  PublishAll,
  LoadSkill,
  WebAnalystAgent,
  // Slack chat runs the v2 orchestrator headlessly (see runChatOrchestrationV2).
  // SlackAgent extends RemoteAnalystAgent and advertises ListDBConnections (which
  // WebAnalystAgent drops), so both must be registered for the orchestrator to
  // instantiate them on a new turn or when reconstructing a saved Slack log.
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
  // in v=2 chat. `CheckEquivalence` is the judge tool dispatched by the
  // DoubleCheck controller.
  BenchmarkAnalystAgent,
  DoubleCheckBenchmarkAgent,
  CheckEquivalence,
  // The new V1 chained tools — registered so saved V1 benchmark logs
  // resume against the post-port behavior. FetchHandleV2 is shared with V2.
  FetchHandleV2,
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

/** Subset of legacy ChatResponse the v=2 path produces. */
export interface V2LegacyChatResponse {
  conversationID: number;
  log_index: number;
  pending_tool_calls: LegacyToolCall[];
  completed_tool_calls: CompletedToolCallFromPython[];
  debug: DebugMessage[];
  error?: string;
}

/** Streaming SSE wire shape (mirrors what /api/chat/stream emits today). */
export type V2LegacyStreamingEvent =
  | { wire: 'streaming_event'; data: ReturnType<typeof piStreamEventToLegacy> }
  | { wire: 'done'; data: V2LegacyChatResponse & { type: 'done'; timestamp: string } }
  | { wire: 'error'; data: { type: 'error'; error: string; timestamp: string } };

interface OrchestrationSetup {
  conversationId: number;
  expectedLogIndex: number;
  orchestrator: Orchestrator;
  rawStream: ReturnType<Orchestrator['run']> | null;
  fatalError?: string;
}

/**
 * Validates v=2 strict-mode invariant: URL `?v=2` must match the
 * conversation file's `meta.version`. Returns null if valid; an error
 * message string if mismatched. Caller responds 400 with the message.
 */
export async function validateV2Mode(
  fileId: number,
  user: EffectiveUser,
  urlIsV2: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const file = await FilesAPI.loadFile(fileId, user);
  const fileIsV2 = isV2ConversationFile(file.data);
  if (urlIsV2 === fileIsV2) return { ok: true };
  return {
    ok: false,
    error: urlIsV2
      ? 'cannot continue v=1 conversation in v=2 mode'
      : 'cannot continue v=2 conversation in v=1 mode',
  };
}

/**
 * Fork a v1 (legacy) conversation into a fresh v2 conversation so it can be
 * continued in v2 mode. The original v1 file is left untouched (zero data
 * loss); the new file's `content.log` is seeded from the v1 log via
 * `legacyLogToPi` and tagged `meta.version: 2` + `meta.forkedFrom`. Returns the
 * new conversation's file id. The continue turn then runs against it normally
 * (setupOrchestration appends after the seeded log).
 */
export async function forkV1ConversationToV2(v1FileId: number, user: EffectiveUser): Promise<number> {
  const file = await FilesAPI.loadFile(v1FileId, user);
  const content = file.data.content as { metadata?: { name?: string }; log?: unknown } | null;
  const legacyLog = (Array.isArray(content?.log) ? content!.log : []) as LegacyLogEntry[];
  const seededLog = legacyLogToPi(legacyLog);
  const firstMessage =
    (file.data.meta as { firstMessage?: string } | null)?.firstMessage ?? content?.metadata?.name ?? undefined;
  const created = await createNewConversation(user, firstMessage, {
    version: 2,
    extraMeta: { forkedFrom: v1FileId },
    initialLog: seededLog as unknown[],
  });
  return created.fileId;
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
 * (→ WebAnalystAgent); the onboarding wizard sends its specialized agents. Any
 * unknown/absent name falls back to WebAnalystAgent. (On resume the orchestrator
 * reconstructs the root from the saved log via the registrables, not this map.)
 */
type RootAgentCtor = new (
  orch: Orchestrator,
  params: { userMessage: string },
  context: RemoteAnalystContext,
) => WebAnalystAgent;

// A Map (not a plain object) so a user-controlled `body.agent` can't reach
// inherited keys like `constructor`/`__proto__` (CodeQL: unvalidated dynamic
// method call). Unknown names → undefined → WebAnalystAgent fallback.
const ROOT_AGENT_BY_NAME = immutableMap<string, RootAgentCtor>([
  ['WebAnalystAgent', WebAnalystAgent],
  ['AnalystAgent', WebAnalystAgent],
  ['OnboardingContextAgent', OnboardingContextAgent],
  ['OnboardingDashboardAgent', OnboardingDashboardAgent],
]);

async function setupOrchestration(
  body: ChatRequest,
  user: EffectiveUser,
  conversationId: number,
): Promise<OrchestrationSetup> {
  const file = await FilesAPI.loadFile(conversationId, user);
  const content = file.data.content as unknown as ConversationFileContent | undefined;
  // Orchestrator log lives at content.log (we persist orchestrator log shape on disk).
  const savedLog: ConversationLog = ((content?.log ?? []) as unknown) as ConversationLog;
  const expectedLogIndex = savedLog.length;

  const narrowedMode: 'org' | 'tutorial' = user.mode === 'tutorial' ? 'tutorial' : 'org';

  const agentArgs = body.agent_args ?? {};
  const contextFileId =
    typeof (agentArgs as { context_file_id?: number }).context_file_id === 'number'
      ? (agentArgs as { context_file_id: number }).context_file_id
      : undefined;

  const serverArgs = await buildServerAgentArgs(
    user,
    contextFileId != null ? { contextFileId } : undefined,
  );

  // Prefer the client-resolved context + schema (the selected context the user
  // picked in the UI), matching what the Python backend does — it uses
  // agent_args.context / agent_args.schema verbatim. Server re-resolution
  // (serverArgs) is only a fallback for requests that arrive without them.
  // (Genuinely clientless callers — Slack, report jobs — call
  // buildServerAgentArgs directly and never reach this chat path.)
  const clientContext =
    typeof (agentArgs as { context?: unknown }).context === 'string'
      ? (agentArgs as { context: string }).context
      : undefined;
  const clientSchema = Array.isArray((agentArgs as { schema?: unknown }).schema)
    ? (agentArgs as { schema: { schema: string; tables: string[] }[] }).schema
    : undefined;
  const clientConnectionId =
    typeof (agentArgs as { connection_id?: unknown }).connection_id === 'string'
      ? (agentArgs as { connection_id: string }).connection_id
      : undefined;
  const clientAllowedVizTypes = Array.isArray((agentArgs as { allowed_viz_types?: unknown }).allowed_viz_types)
    ? (agentArgs as { allowed_viz_types: string[] }).allowed_viz_types
    : undefined;
  const clientAgentName =
    typeof (agentArgs as { agent_name?: unknown }).agent_name === 'string'
      ? (agentArgs as { agent_name: string }).agent_name
      : undefined;
  // Skills: client sends agent_args.skills.{selected, user_catalog} and
  // unrestricted_mode (matching Python). Page type is derived from
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
  const pageType = getPageType(clientAppState);
  // Attachments: v2 sends images inline as base64 data: URLs (no upload), so we
  // just parse them; text passes through. Remote URLs are ignored (no fetch).
  const attachments = normalizeAttachments((agentArgs as { attachments?: unknown }).attachments);
  const schemaForWhitelist = clientSchema ?? serverArgs.schema;
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

  // V2 benchmark conversations get the V2 toolset + V2 agent classes; V1
  // benchmark conversations get the `Base*` tool swaps on the production
  // registrables; production conversations get the default registrables.
  const registrables = isV2Bench
    ? V2_BENCHMARK_REGISTRABLES
    : isBenchmarkRoot
      ? withSwaps(V2_REGISTRABLES, BENCHMARK_TOOL_SWAPS)
      : V2_REGISTRABLES;
  const orch = new Orchestrator(registrables, [...savedLog]);

  // Resume path: frontend sends back [ToolCall, ToolMessage][] tuples.
  // ToolMessage (from Redux/executeToolCall) lacks .function — patch it from
  // tuple[0] (the original ToolCall) so legacyToolResultToPi can read .function.name.
  if (body.completed_tool_calls && body.completed_tool_calls.length > 0) {
    const piResults = body.completed_tool_calls.map((tuple) => {
      const toolCall = tuple[0];
      const result = tuple[1] as unknown as CompletedToolCallFromPython;
      const patched: CompletedToolCallFromPython = {
        ...result as unknown as CompletedToolCallFromPython,
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
      const fileMeta = (file.data as { meta?: Record<string, unknown> | null }).meta ?? null;
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
        rawStream: orch.run(agent),
      };
    }
    const ctx: RemoteAnalystContext = {
      userId: String(user.userId ?? user.email),
      mode: narrowedMode,
      effectiveUser: user,
      connectionId: clientConnectionId ?? serverArgs.connection_id,
      whitelistedTables: whitelistedTables.length > 0 ? whitelistedTables : undefined,
      contextDocs: clientContext || serverArgs.context || undefined,
      allowedVizTypes: clientAllowedVizTypes,
      schema: clientSchema,
      homeFolder: resolveHomeFolderSync(user.mode, user.home_folder || ''),
      role: user.role,
      agentName: clientAgentName,
      appState: clientAppState,
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
      rawStream: orch.run(agent),
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

/**
 * Pull the first user message from a orchestrator log diff. Used to rename a
 * fresh v=2 conversation file from "New Conversation" → first message
 * preview. Returns null if no root invocation present.
 */
function firstUserMessageFromPiDiff(piDiff: PiLogEntry[]): string | null {
  for (const entry of piDiff) {
    const e = entry as { type?: string; parent_id?: string | null; arguments?: { userMessage?: unknown } };
    if (e.type === 'toolCall' && e.parent_id === null && typeof e.arguments?.userMessage === 'string') {
      return e.arguments.userMessage;
    }
  }
  return null;
}

/** Persist the new entries and build the legacy ChatResponse. */
async function persistAndBuildLegacyResponse(
  conversationId: number,
  expectedLogIndex: number,
  orch: Orchestrator,
  user: EffectiveUser,
  runError: string | undefined,
): Promise<V2LegacyChatResponse> {
  const fullPiLog = orch.log;
  const piDiff: PiLogEntry[] = fullPiLog.slice(expectedLogIndex);

  // Persist orchestrator entries via the legacy append (it works for any JSON-array
  // log; the orchestrator entries are valid JSON). Forks if the log length doesn't
  // match expected, mirroring legacy semantics — and `meta.version` is
  // preserved across the fork (see `appendLogToConversation`).
  let finalConversationId = conversationId;
  if (piDiff.length > 0) {
    const appendResult = await appendLogToConversation(
      conversationId,
      piDiff as unknown as LegacyLogEntry[],
      expectedLogIndex,
      user,
    );
    finalConversationId = appendResult.conversationID;

    // V=2-specific rename on the first turn — the legacy rename inside
    // `appendLogToConversation` looks for `_type:'task'` entries and won't
    // find any in orchestrator diffs. Pull the user message off the root
    // `AgentInvocation` and update name + path explicitly.
    if (expectedLogIndex === 0) {
      const firstMsg = firstUserMessageFromPiDiff(piDiff);
      if (firstMsg) {
        const displayName = truncateMessageForName(firstMsg);
        const userId = user.userId?.toString() || user.email;
        const newPath = resolvePath(
          user.mode,
          `/logs/conversations/${userId}/${Date.now()}-${slugify(firstMsg)}.chat.json`,
        );
        await FilesAPI.updateNamePath(finalConversationId, displayName, newPath, user);
      }
    }
  }

  // Translate the FULL log to legacy shape so completed_tool_calls / debug
  // / log_index reflect the legacy view, then slice to the new diff for
  // the response.
  const legacyFullLog = piLogToLegacy(fullPiLog);
  const completedToolCalls: CompletedToolCallFromPython[] = legacyFullLog
    .filter((e) => e._type === 'task_result')
    .map((e) => {
      const r = e as Extract<LegacyLogEntry, { _type: 'task_result' }>;
      const matchingTask = legacyFullLog.find(
        (t) => t._type === 'task' && (t as { unique_id?: string }).unique_id === r._task_unique_id,
      ) as Extract<LegacyLogEntry, { _type: 'task' }> | undefined;
      return {
        role: 'tool' as const,
        tool_call_id: r._task_unique_id,
        content: r.result,
        run_id: matchingTask?._run_id ?? 'run',
        function: {
          name: matchingTask?.agent ?? 'Unknown',
          arguments: (matchingTask?.args ?? {}) as Record<string, unknown>,
        },
        created_at: r.created_at,
        ...(r.details ? { details: r.details } : {}),
      };
    });

  const debug: DebugMessage[] = extractDebugMessages(legacyFullLog);

  // Pending tool calls: orchestrator's pending list (frontend tools that
  // need bridging) — translate per-call to legacy ToolCall shape.
  const orchPending: PiPendingToolCall[] = orch.getPendingToolCalls();
  const pending_tool_calls: LegacyToolCall[] = orchPending.map((p) => ({
    id: p.id,
    type: 'function' as const,
    function: {
      name: p.name,
      arguments: p.parameters as Record<string, unknown>,
    },
  }));

  return {
    conversationID: finalConversationId,
    log_index: legacyFullLog.length,
    pending_tool_calls,
    completed_tool_calls: completedToolCalls,
    debug,
    ...(runError ? { error: runError } : {}),
  };
}

/**
 * Drain-and-snapshot variant — used by `POST /api/chat` (non-streaming).
 */
export async function runChatTurnV2(
  body: ChatRequest,
  user: EffectiveUser,
  conversationId: number,
): Promise<V2LegacyChatResponse> {
  const setup = await setupOrchestration(body, user, conversationId);
  if (setup.fatalError) {
    return {
      conversationID: conversationId,
      log_index: setup.expectedLogIndex,
      pending_tool_calls: [],
      completed_tool_calls: [],
      debug: [],
      error: setup.fatalError,
    };
  }
  let runError: string | undefined;
  try {
    if (setup.rawStream) {
      for await (const ev of setup.rawStream) {
        const evType = (ev as { type?: string }).type;
        if (evType === 'error') {
          const errMsg = (ev as unknown as { error?: { errorMessage?: string } }).error?.errorMessage;
          if (errMsg && !runError) {
            runError = errMsg;
            console.error('[v2/chat] orchestrator error event:', errMsg);
          }
        }
      }
      await setup.rawStream.result();
    }
  } catch (err) {
    console.error('[v2/chat] orchestrator run threw:', err);
    runError = err instanceof Error ? err.message : String(err);
  }
  return persistAndBuildLegacyResponse(
    setup.conversationId,
    setup.expectedLogIndex,
    setup.orchestrator,
    user,
    runError,
  );
}

/**
 * Streaming variant — yields legacy SSE wire frames. Used by
 * `POST /api/chat/stream`.
 *
 * Frame types emitted:
 *   - `streaming_event` for each orchestrator stream event that maps to a legacy
 *     event type (text_delta → StreamedContent, etc.).
 *   - `done` once at the end with the same payload `runChatTurnV2` returns.
 *   - `error` if orchestration throws.
 */
export async function* runChatTurnStreamV2(
  body: ChatRequest,
  user: EffectiveUser,
  conversationId: number,
): AsyncGenerator<V2LegacyStreamingEvent, void, unknown> {
  const setup = await setupOrchestration(body, user, conversationId);
  if (setup.fatalError) {
    const response = await persistAndBuildLegacyResponse(
      setup.conversationId,
      setup.expectedLogIndex,
      setup.orchestrator,
      user,
      setup.fatalError,
    );
    yield {
      wire: 'done',
      data: { ...response, type: 'done', timestamp: new Date().toISOString() },
    };
    return;
  }
  let runError: string | undefined;
  try {
    if (setup.rawStream) {
      for await (const ev of setup.rawStream) {
        // Capture orchestrator error events (e.g. LLM auth failures, network
        // errors). EventStream.result() never throws — errors surface only as
        // stream events — so we must intercept them here or they are silently
        // dropped by piStreamEventToLegacy returning null.
        const evType = (ev as { type?: string }).type;
        if (evType === 'error') {
          const errMsg = (ev as unknown as { error?: { errorMessage?: string } }).error?.errorMessage;
          if (errMsg && !runError) {
            runError = errMsg;
            console.error('[v2/stream] orchestrator error event:', errMsg);
          }
          continue;
        }
        const translated = piStreamEventToLegacy(ev as StreamEvent, setup.conversationId);
        if (translated) {
          yield { wire: 'streaming_event', data: translated };
        }
      }
      await setup.rawStream.result();
    }
  } catch (err) {
    console.error('[v2/stream] orchestrator run threw:', err);
    runError = err instanceof Error ? err.message : String(err);
  }

  let response: V2LegacyChatResponse;
  try {
    response = await persistAndBuildLegacyResponse(
      setup.conversationId,
      setup.expectedLogIndex,
      setup.orchestrator,
      user,
      runError,
    );
  } catch (persistErr) {
    console.error('[v2/stream] persist threw:', persistErr);
    const persistError = persistErr instanceof Error ? persistErr.message : String(persistErr);
    response = {
      conversationID: setup.conversationId,
      log_index: setup.expectedLogIndex,
      pending_tool_calls: [],
      completed_tool_calls: [],
      debug: [],
      error: runError ?? persistError,
    };
  }
  yield {
    wire: 'done',
    data: { ...response, type: 'done', timestamp: new Date().toISOString() },
  };
}
