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
import type {
  ConversationLog,
  ConversationLogEntry as PiLogEntry,
  PendingToolCall as PiPendingToolCall,
  RegistrableClass,
  StreamEvent,
} from '@/orchestrator/types';
import { WebAnalystAgent, EditFile, CreateFile } from '@/agents/web-analyst/web-analyst';
import { ReadFiles, SearchFiles } from '@/agents/analyst/file-tools';
import { ListDBConnections, SearchDBSchema, ExecuteSQL } from '@/agents/benchmark-analyst/db-tools';
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
import { appendLogToConversation } from '@/lib/conversations';
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

export const V2_REGISTRABLES: RegistrableClass[] = [
  ListDBConnections,
  SearchDBSchema,
  ExecuteSQL,
  ReadFiles,
  SearchFiles,
  EditFile,
  CreateFile,
  WebAnalystAgent,
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
  const ctx: RemoteAnalystContext = {
    userId: String(user.userId ?? user.email),
    mode: narrowedMode,
    effectiveUser: user,
    connectionId: serverArgs.connection_id,
    whitelistedTables: whitelistedTables.length > 0 ? whitelistedTables : undefined,
    contextDocs: serverArgs.context || undefined,
  };

  const orch = new Orchestrator(V2_REGISTRABLES, [...savedLog]);

  // Resume path: frontend sends back legacy CompletedToolCallFromPython[]
  // (in body.completed_tool_calls — note: ChatRequest types this as a tuple
  // `[ToolCall, ToolMessage][]`, but the second element is the result with
  // tool_call_id + content + run_id, which is exactly the shape we need to
  // translate per-entry). Translate each entry through `legacyToolResultToPi`
  // and feed to orchestrator.resume().
  if (body.completed_tool_calls && body.completed_tool_calls.length > 0) {
    const piResults = body.completed_tool_calls.map((tuple) => {
      const result = tuple[1] as unknown as CompletedToolCallFromPython;
      return legacyToolResultToPi(result);
    });
    return {
      conversationId,
      expectedLogIndex,
      orchestrator: orch,
      rawStream: orch.resume(piResults),
    };
  }

  if (body.user_message) {
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
  // match expected, mirroring legacy semantics.
  let finalConversationId = conversationId;
  if (piDiff.length > 0) {
    // The legacy appendLogToConversation has a v=1-specific rename branch
    // that introspects `_type === 'task'` to find the user message. For v=2
    // entries that branch silently no-ops (no _type field), so the rename
    // is skipped — fine for the cleanup pass.
    const appendResult = await appendLogToConversation(
      conversationId,
      piDiff as unknown as LegacyLogEntry[],
      expectedLogIndex,
      user,
    );
    finalConversationId = appendResult.conversationID;
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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- drain
      for await (const _ev of setup.rawStream) {
        /* drain */
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

  const response = await persistAndBuildLegacyResponse(
    setup.conversationId,
    setup.expectedLogIndex,
    setup.orchestrator,
    user,
    runError,
  );
  yield {
    wire: 'done',
    data: { ...response, type: 'done', timestamp: new Date().toISOString() },
  };
}
