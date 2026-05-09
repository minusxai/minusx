// V=2 chat orchestration — server-side bridge between the legacy /api/chat
// + /api/chat/stream routes and the pi-ai orchestrator. Translates inputs
// (legacy ChatRequest → pi-ai message/resume) and outputs (pi-ai log +
// stream events → legacy ChatResponse + streaming_event SSE frames) so the
// frontend stays unchanged.
//
// The data-shape boundary lives entirely in this file plus
// `lib/chat-translator/index.ts`. No frontend code knows about pi-ai.

import 'server-only';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { setupV2ServerSources } from '@/lib/v2-server-sources';
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
  LoadSkillFrontend,
} from '@/agents/web-analyst/web-analyst';
import { SearchFiles } from '@/agents/analyst/file-tools';
import { ListDBConnections, SearchDBSchema, ExecuteSQL } from '@/agents/benchmark-analyst/db-tools';
import { BenchmarkAnalystAgent } from '@/agents/benchmark-analyst/benchmark-analyst';
import type { BenchmarkAnalystContext } from '@/agents/benchmark-analyst/types';
import {
  buildBenchmarkSources,
  loadBenchmarkConnectionsFromEnv,
} from '@/agents/benchmark-analyst/connection-source';
import type { RemoteAnalystContext } from '@/agents/analyst/types';
import { FilesAPI } from '@/lib/data/files.server';
import { buildServerAgentArgs } from '@/lib/chat/agent-args.server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import {
  piLogToLegacy,
  piStreamEventToLegacy,
  legacyToolResultToPi,
} from '@/lib/chat-translator';
import { extractDebugMessages } from '@/lib/conversations-utils';
import { appendLogToConversation, truncateMessageForName, slugify } from '@/lib/conversations';
import { resolvePath } from '@/lib/mode/path-resolver';
import { isV2ConversationFile } from '@/lib/chat-translator';
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

// Wire the production `SqlExecutor` (and future `SchemaSource`) on first
// import. Idempotent — safe even when this module is loaded by both
// `/api/chat` and `/api/chat/stream` handlers.
setupV2ServerSources();

export const V2_REGISTRABLES: RegistrableClass[] = [
  ListDBConnections,
  SearchDBSchema,
  ExecuteSQL,
  ReadFiles,
  SearchFiles,
  EditFile,
  CreateFile,
  Navigate,
  ClarifyFrontend,
  PublishAll,
  LoadSkillFrontend,
  WebAnalystAgent,
  // Lets the orchestrator resume benchmark conversations (root invocation
  // name is 'BenchmarkAnalystAgent') in v=2 chat.
  BenchmarkAnalystAgent,
];

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
 * Return the root invocation's agent name from a saved pi-ai conversation
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
 * Reconstruct a BenchmarkAnalystContext from a saved benchmark conversation
 * log. The runner stored connections + whitelist on the root invocation's
 * `context`, but `schemaSource`/`sqlExecutor` (functions) serialised as
 * `{}`. We deliberately leave those undefined so the DB tools fall back to
 * the production server-side singletons wired by `setupV2ServerSources`.
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

async function setupOrchestration(
  body: ChatRequest,
  user: EffectiveUser,
  conversationId: number,
): Promise<OrchestrationSetup> {
  const file = await FilesAPI.loadFile(conversationId, user);
  const content = file.data.content as unknown as ConversationFileContent | undefined;
  // Pi-ai log lives at content.log (we persist pi-ai shape on disk).
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
  const whitelistedTables: string[] = [];
  for (const s of serverArgs.schema) {
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
  const isBenchmarkRoot = getRootAgentName(savedLog) === 'BenchmarkAnalystAgent';

  const orch = new Orchestrator(V2_REGISTRABLES, [...savedLog]);

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
      // Wire NodeConnector-backed executors per-conversation from
      // BENCHMARK_CONNECTIONS_CONFIG env (the same env var the runner
      // uses) so SQL and schema lookups go to the benchmark's own
      // connections, NOT production's runQuery + FilesAPI. Per-context
      // executors override the production singletons (see db-tools.ts:
      // `this.context.sqlExecutor ?? getSqlExecutor()`). When the env is
      // unset, allowed connectors are missing → executor returns a clear
      // "connector 'X' not loaded" error rather than a confusing
      // "missing effectiveUser" one.
      const baseBenchCtx = buildBenchmarkContextFromSavedLog(savedLog);
      const allowedNames = new Set((baseBenchCtx.connections ?? []).map((c) => c.name));
      const { connectorsByName } = loadBenchmarkConnectionsFromEnv();
      const { schemaSource, sqlExecutor } = buildBenchmarkSources(connectorsByName, allowedNames);
      const benchCtx: BenchmarkAnalystContext & { effectiveUser: EffectiveUser } = {
        ...baseBenchCtx,
        schemaSource,
        sqlExecutor,
        effectiveUser: user,
      };
      const agent = new BenchmarkAnalystAgent(orch, { userMessage: body.user_message }, benchCtx);
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
      connectionId: serverArgs.connection_id,
      whitelistedTables: whitelistedTables.length > 0 ? whitelistedTables : undefined,
      contextDocs: serverArgs.context || undefined,
    };
    const agent = new WebAnalystAgent(orch, { userMessage: body.user_message }, ctx);
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
 * Pull the first user message from a pi-ai log diff. Used to rename a
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

  // Persist pi-ai entries via the legacy append (it works for any JSON-array
  // log; the pi-ai entries are valid JSON). Forks if the log length doesn't
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
    // find any in pi-ai diffs. Pull the user message off the root
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
 *   - `streaming_event` for each pi-ai stream event that maps to a legacy
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
