// Chat translator — pi-ai ↔ legacy task-log shape.
//
// One module, three exports:
//   piLogToLegacy           pi-ai ConversationLog            → ConversationLogEntry[]      (forward; file reads + done frame)
//   piStreamEventToLegacy   StreamEvent                      → legacy SSE payload | null   (per-event mid-stream)
//   legacyToolResultToPi    CompletedToolCallFromPython      → ToolResultMessage           (reverse; orchestrator resume)
//
// Lives at the backend boundary so the frontend never sees pi-ai shape.
// All three functions are pure and deterministic.

import type {
  ConversationLog,
  ConversationLogEntry as PiLogEntry,
  AgentInvocation,
  StreamEvent,
} from '@/orchestrator/types';
import type {
  AssistantMessage,
  ToolResultMessage,
  ToolCall as PiToolCall,
  TextContent,
  ThinkingContent,
} from '@mariozechner/pi-ai';
import type {
  ConversationLogEntry as LegacyLogEntry,
  TaskLogEntry,
  TaskResultEntry,
  TaskDebugEntry,
  ToolCallDetails,
} from '@/lib/types';
import type { CompletedToolCallFromPython } from '@/lib/chat-orchestration';

// ─── shared private helpers ─────────────────────────────────────────

type AgentInvocationEntry = AgentInvocation & { parent_id: string | null };
type AssistantEntry = AssistantMessage & { parent_id: string | null };
type ToolResultEntry = ToolResultMessage & { parent_id: string | null };

function isAgentInvocation(e: PiLogEntry): e is AgentInvocationEntry {
  return (e as { type?: string }).type === 'toolCall';
}
function isAssistant(e: PiLogEntry): e is AssistantEntry {
  return 'role' in e && e.role === 'assistant';
}
function isToolResult(e: PiLogEntry): e is ToolResultEntry {
  return 'role' in e && e.role === 'toolResult';
}

function pickText(content: AssistantMessage['content'] | ToolResultMessage['content'] | undefined): string {
  if (!content || !Array.isArray(content)) return '';
  return content
    .filter((c): c is TextContent => (c as { type?: string }).type === 'text')
    .map((c) => c.text)
    .join('\n');
}

function pickThinking(content: AssistantMessage['content'] | undefined): string {
  if (!content || !Array.isArray(content)) return '';
  return content
    .filter((c): c is ThinkingContent => (c as { type?: string }).type === 'thinking')
    .map((c) => c.thinking)
    .join('\n');
}

function pickToolCalls(content: AssistantMessage['content'] | undefined): PiToolCall[] {
  if (!content || !Array.isArray(content)) return [];
  return content.filter((c): c is PiToolCall => (c as { type?: string }).type === 'toolCall');
}

function tsFromTimestamp(ts: number | undefined): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return new Date(0).toISOString();
  return new Date(ts).toISOString();
}

function deriveRunId(seed: string): string {
  // Stable per-invocation run id. The frontend doesn't depend on the actual
  // value; the legacy task-log just requires it to exist.
  return `run-${seed}`;
}

// ─── v2 → v1 tool alias table ────────────────────────────────────────
//
// The frontend UI speaks the legacy v1 task-log contract: tool names like
// `ExecuteQuery` with args `{query, connectionId}`. The v2 orchestrator
// uses pi-ai-native names (`ExecuteSQL` with `{sql, connection}`). This
// table renames + reshapes during the v2→legacy translation so the UI
// dispatch and display components keep working unchanged.
//
// Constraint: only server-side tools belong here. Frontend tools (Clarify,
// Navigate, etc.) bridge through the UI and round-trip back via
// `legacyToolResultToPi` — renaming them outbound would create a
// `toolName` mismatch in the pi-ai log on the next turn. Server-side
// tools (extend `MXTool` and run in the orchestrator) never round-trip.
const V2_TO_V1_TOOL_NAME: Record<string, string> = {
  ExecuteSQL: 'ExecuteQuery',
  ListDBConnections: 'ReadFiles',
};

function v2ToV1ToolName(name: string): string {
  return V2_TO_V1_TOOL_NAME[name] ?? name;
}

function v2ToV1ToolArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (name === 'ExecuteSQL') {
    return { query: args.sql, connectionId: args.connection };
  }
  return args;
}

// ─── piLogToLegacy: forward ─────────────────────────────────────────

/**
 * Forward translation: pi-ai ConversationLog → legacy ConversationLogEntry[].
 *
 * Used by the backend route handlers when responding to the frontend (which
 * expects legacy task-log shape). Walks the pi-ai log once, emits one or
 * more legacy entries per pi-ai entry per the rules documented in
 * `lib/chat-translator/index.ts` plan.
 */
export function piLogToLegacy(piLog: ConversationLog): LegacyLogEntry[] {
  const out: LegacyLogEntry[] = [];
  // task_unique_id → output index, used to back-fill task_results when
  // ToolResultMessages arrive.
  const taskById = new Map<string, number>();

  for (let i = 0; i < piLog.length; i++) {
    const entry = piLog[i];

    if (isAgentInvocation(entry)) {
      // Root invocation: user turn.
      if (entry.parent_id === null) {
        const args = (entry.arguments ?? {}) as { userMessage?: unknown; [k: string]: unknown };
        const { userMessage, ...rest } = args;
        const userMessageStr = typeof userMessage === 'string' ? userMessage : '';
        const task: TaskLogEntry = {
          _type: 'task',
          _run_id: deriveRunId(entry.id),
          agent: 'AnalystAgent',
          args: { user_message: userMessageStr, ...rest },
          unique_id: entry.id,
          created_at: tsFromTimestamp(undefined),
        };
        taskById.set(entry.id, out.length);
        out.push(task);
        continue;
      }
      // Sub-agent invocation: tool task.
      if (taskById.has(entry.id)) continue; // assistant message may have already emitted it
      const subTask: TaskLogEntry = {
        _type: 'task',
        _run_id: deriveRunId(entry.id),
        _parent_unique_id: entry.parent_id,
        agent: entry.name,
        args: entry.arguments ?? {},
        unique_id: entry.id,
        created_at: tsFromTimestamp(undefined),
      };
      taskById.set(entry.id, out.length);
      out.push(subTask);
      continue;
    }

    if (isAssistant(entry)) {
      const text = pickText(entry.content);
      const thinking = pickThinking(entry.content);
      const toolCalls = pickToolCalls(entry.content);
      const createdAt = tsFromTimestamp(entry.timestamp);
      const turnPrimaryTaskId: { id: string } = { id: '' };

      // Build content_blocks in pi-ai content order (thinking first if
      // present, then text). Frontend's `ContentDisplay` walks this array
      // and routes `type:'thinking'` blocks into the "Show Thinking" panel
      // and `type:'text'` blocks into the answer body — same behavior v=1
      // gets natively. Preserves `signature` on thinking blocks so the
      // signature is available for opaque continuations.
      const contentBlocks: Array<Record<string, unknown>> = [];
      const blocks = Array.isArray(entry.content) ? entry.content : [];
      for (const block of blocks) {
        const t = (block as { type?: string }).type;
        if (t === 'thinking') {
          const tb = block as { thinking?: string; thinkingSignature?: string };
          const out: Record<string, unknown> = { type: 'thinking', thinking: tb.thinking ?? '' };
          if (tb.thinkingSignature) out.signature = tb.thinkingSignature;
          contentBlocks.push(out);
        } else if (t === 'text') {
          const tb = block as { text?: string };
          contentBlocks.push({ type: 'text', text: tb.text ?? '' });
        }
        // toolCall blocks become their own task entries below — not in
        // content_blocks (matches v=1 convention).
      }

      // Synthetic TalkToUser pair when the assistant emitted text or thinking.
      if (contentBlocks.length > 0) {
        const ttuId = `asst-text-${i}`;
        const ttuTask: TaskLogEntry = {
          _type: 'task',
          _run_id: deriveRunId(ttuId),
          _parent_unique_id: entry.parent_id ?? undefined,
          agent: 'TalkToUser',
          args: { content_blocks: contentBlocks },
          unique_id: ttuId,
          created_at: createdAt,
        };
        taskById.set(ttuId, out.length);
        out.push(ttuTask);

        // v=1-compatible result shape: JSON-stringified `{ success,
        // content_blocks }`. Frontend's ContentDisplay parses this string
        // and walks content_blocks for thinking + text rendering. Usage
        // lives on the matching task_debug entry, NOT here — `details` is
        // null to match v=1.
        const ttuResult: TaskResultEntry = {
          _type: 'task_result',
          _task_unique_id: ttuId,
          result: JSON.stringify({
            success: entry.stopReason !== 'error',
            content_blocks: contentBlocks,
          }),
          details: null as unknown as ToolCallDetails,
          created_at: createdAt,
        };
        out.push(ttuResult);
        turnPrimaryTaskId.id = ttuId;
      }
      void text;
      void thinking;

      // Per-tool-call tasks (no result yet — pending until a ToolResultMessage lands).
      for (const tc of toolCalls) {
        if (taskById.has(tc.id)) continue;
        const tcTask: TaskLogEntry = {
          _type: 'task',
          _run_id: deriveRunId(tc.id),
          _parent_unique_id: entry.parent_id ?? undefined,
          agent: v2ToV1ToolName(tc.name),
          args: v2ToV1ToolArgs(tc.name, (tc.arguments ?? {}) as Record<string, unknown>),
          unique_id: tc.id,
          created_at: createdAt,
        };
        taskById.set(tc.id, out.length);
        out.push(tcTask);
        if (!turnPrimaryTaskId.id) turnPrimaryTaskId.id = tc.id;
      }

      // Per-turn task_debug entry from usage. Attach to the primary task of
      // the turn (TalkToUser if present, else first toolCall).
      if (entry.usage && turnPrimaryTaskId.id) {
        // _duration and _lllmCallId are attached by callLLM to the first
        // ToolCall in content (or to the AssistantMessage itself for text-only stops).
        const debugSrc = (toolCalls[0] as unknown as Record<string, unknown>) ?? (entry as unknown as Record<string, unknown>);
        const duration = (debugSrc['_duration'] as number | undefined) ?? 0;
        const lllmCallId = debugSrc['_lllmCallId'] as string | undefined;
        const debug: TaskDebugEntry = {
          _type: 'task_debug',
          _task_unique_id: turnPrimaryTaskId.id,
          duration,
          llmDebug: [
            {
              total_tokens: entry.usage.totalTokens,
              prompt_tokens: entry.usage.input,
              completion_tokens: entry.usage.output,
              cache_read_tokens: entry.usage.cacheRead,
              cache_write_tokens: entry.usage.cacheWrite,
              cost: entry.usage.cost?.total ?? 0,
              model: entry.model,
              duration,
              ...(lllmCallId ? { lllm_call_id: lllmCallId } : {}),
            },
          ],
          created_at: createdAt,
        };
        out.push(debug);
      }
      continue;
    }

    if (isToolResult(entry)) {
      if (!taskById.has(entry.toolCallId)) continue; // orphan — drop
      const text = pickText(entry.content);
      const piDetails = (entry.details ?? {}) as Record<string, unknown>;
      const result: TaskResultEntry = {
        _type: 'task_result',
        _task_unique_id: entry.toolCallId,
        result: text,
        details: { ...piDetails, success: !entry.isError } as ToolCallDetails,
        created_at: tsFromTimestamp(entry.timestamp),
      };
      out.push(result);
      continue;
    }
  }

  return out;
}

// ─── piStreamEventToLegacy: streaming ────────────────────────────────

interface LegacyStreamingEvent {
  type: 'StreamedContent' | 'StreamedThinking' | 'ToolCreated' | 'ToolCompleted';
  payload: { chunk: string } | { id: string; type: 'function'; function: { name: string; arguments: Record<string, unknown> } } | CompletedToolCallFromPython;
  conversationID: number;
}

/**
 * Per-event SSE translation. Returns null for pi-ai events that have no
 * legacy counterpart; the caller should skip those (they're internal
 * signals like text_start/end).
 */
export function piStreamEventToLegacy(
  event: StreamEvent,
  conversationID: number,
): LegacyStreamingEvent | null {
  const type = (event as { type?: string }).type;

  if (type === 'text_delta') {
    const ev = event as Extract<StreamEvent, { type: 'text_delta' }>;
    return {
      type: 'StreamedContent',
      payload: { chunk: ev.delta },
      conversationID,
    };
  }

  if (type === 'thinking_delta') {
    const ev = event as Extract<StreamEvent, { type: 'thinking_delta' }>;
    return {
      type: 'StreamedThinking',
      payload: { chunk: ev.delta },
      conversationID,
    };
  }

  if (type === 'toolcall_end') {
    const ev = event as Extract<StreamEvent, { type: 'toolcall_end' }>;
    return {
      type: 'ToolCreated',
      payload: {
        id: ev.toolCall.id,
        type: 'function',
        function: {
          name: v2ToV1ToolName(ev.toolCall.name),
          arguments: v2ToV1ToolArgs(
            ev.toolCall.name,
            (ev.toolCall.arguments ?? {}) as Record<string, unknown>,
          ),
        },
      },
      conversationID,
    };
  }

  // Internal/structural events that legacy doesn't model — skip.
  return null;
}

// ─── file-level convenience: translate a v=2 conversation file ─────

/**
 * Returns true if the given file is a v=2 conversation — i.e. type
 * 'conversation' with `meta.version === 2`. Centralized so the routes
 * agree on the predicate.
 */
export function isV2ConversationFile(file: {
  type?: string | null;
  meta?: unknown;
}): boolean {
  if (file.type !== 'conversation') return false;
  const meta = file.meta as { version?: number } | null | undefined;
  return meta?.version === 2;
}

/**
 * Translate a v=2 conversation file's `content.log` (pi-ai shape) into
 * legacy `ConversationLogEntry[]` so the frontend never sees pi-ai shape.
 * Mutates a shallow copy of `file` (preserves all other fields). v=1 files
 * (or non-conversation files) pass through unchanged.
 */
export function translateConversationForFrontend<T extends {
  type?: string | null;
  meta?: unknown;
  content?: unknown;
}>(file: T): T {
  if (!isV2ConversationFile(file)) return file;
  const content = file.content as { log?: unknown; metadata?: unknown } | null | undefined;
  if (!content || !Array.isArray(content.log)) return file;
  const translated = piLogToLegacy(content.log as ConversationLog);
  return {
    ...file,
    content: {
      ...content,
      log: translated,
    },
  };
}

// ─── legacyToolResultToPi: reverse for resume ────────────────────────

/**
 * Reverse mapping for orchestrator `resume()` input. The frontend sends back
 * legacy `CompletedToolCallFromPython` shape; the orchestrator wants pi-ai
 * `ToolResultMessage`. Single-direction, no information loss for the fields
 * the orchestrator actually reads.
 */
export function legacyToolResultToPi(toolResult: CompletedToolCallFromPython): ToolResultMessage {
  const text =
    typeof toolResult.content === 'string'
      ? toolResult.content
      : JSON.stringify(toolResult.content);
  const details = toolResult.details as { success?: boolean } | undefined;
  const isError = details ? details.success === false : false;
  return {
    role: 'toolResult',
    toolCallId: toolResult.tool_call_id,
    toolName: toolResult.function.name,
    content: [{ type: 'text', text }],
    isError,
    timestamp: Date.parse(toolResult.created_at) || 0,
    ...(toolResult.details ? { details: toolResult.details } : {}),
  };
}
