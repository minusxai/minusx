// Chat translator — orchestrator ↔ legacy task-log shape.
//
// One module, three exports:
//   piLogToLegacy           orchestrator ConversationLog            → ConversationLogEntry[]      (forward; file reads + done frame)
//   piStreamEventToLegacy   StreamEvent                      → legacy SSE payload | null   (per-event mid-stream)
//   legacyToolResultToPi    CompletedToolCallResult      → ToolResultMessage           (reverse; orchestrator resume)
//
// Lives at the backend boundary so the frontend never sees orchestrator log shape.
// All three functions are pure and deterministic.

import type {
  ConversationLog,
  ConversationLogEntry as PiLogEntry,
  AgentInvocation,
  StreamEvent,
} from '@/orchestrator/types';
import type { AssistantMessage, ToolResultMessage, ToolCall as PiToolCall, TextContent, ThinkingContent, ImageContent } from '@/orchestrator/llm';
import { imageContentFromUrl } from '@/lib/projection/image-validate';
import type {
  ConversationLogEntry as LegacyLogEntry,
  TaskLogEntry,
  TaskResultEntry,
  TaskDebugEntry,
  ToolCallDetails,
} from '@/lib/types';
import type { CompletedToolCallResult } from '@/lib/chat-orchestration';

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

/**
 * Invocation (`toolCall`) pi entries — the user turn and sub-agent tasks — carry no timestamp of
 * their own; only assistant/toolResult entries do. A turn's chronological position is that of its
 * first response, so derive the invocation's timestamp by looking ahead to the next timestamped
 * entry (falling back to the previous one for a trailing, not-yet-answered turn).
 *
 * Without this, every user message was stamped epoch-0. `parseLogToMessages` re-sorts by `created_at`
 * to interleave the errors[] rows, and epoch-0 floated ALL user messages to the very top — so a
 * reopened conversation rendered every user bubble stacked above every agent reply. Deriving a real
 * timestamp keeps the sort chronological (turns stay interleaved).
 */
function invocationTimestamp(piLog: ConversationLog, from: number): number | undefined {
  for (let j = from + 1; j < piLog.length; j++) {
    const t = (piLog[j] as { timestamp?: unknown }).timestamp;
    if (typeof t === 'number' && Number.isFinite(t)) return t;
  }
  for (let j = from - 1; j >= 0; j--) {
    const t = (piLog[j] as { timestamp?: unknown }).timestamp;
    if (typeof t === 'number' && Number.isFinite(t)) return t;
  }
  return undefined;
}

function deriveRunId(seed: string): string {
  // Stable per-invocation run id. The frontend doesn't depend on the actual
  // value; the legacy task-log just requires it to exist.
  return `run-${seed}`;
}

// ─── v2 → v1 tool alias table ────────────────────────────────────────
//
// Empty today: every v2 orchestrator tool now uses its v1 / UI-native
// name natively (ExecuteQuery, ListDBConnections, SearchDBSchema, etc.
// all have first-class display components). Kept as an extension point
// so a future v2-only tool that doesn't have a UI mapping can be aliased
// here without touching the translator's hot path again.
//
// Constraint when adding entries: only server-side tools belong here.
// Frontend tools (Clarify, Navigate, etc.) bridge through the UI and
// round-trip back via `legacyToolResultToPi` — renaming them outbound
// would create a `toolName` mismatch in the orchestrator log on the next turn.
// Server-side tools (extend `MXTool`, run in the orchestrator) never
// round-trip.
const V2_TO_V1_TOOL_NAME: Record<string, string> = {};

function v2ToV1ToolName(name: string): string {
  return V2_TO_V1_TOOL_NAME[name] ?? name;
}

// ─── piLogToLegacy: forward ─────────────────────────────────────────

/**
 * Forward translation: orchestrator ConversationLog → legacy ConversationLogEntry[].
 *
 * Used by the backend route handlers when responding to the frontend (which
 * expects legacy task-log shape). Walks the orchestrator log once, emits one or
 * more legacy entries per orchestrator entry per the rules documented in
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
          created_at: tsFromTimestamp(invocationTimestamp(piLog, i)),
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
        created_at: tsFromTimestamp(invocationTimestamp(piLog, i)),
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

      // Build content_blocks in orchestrator content order (thinking first if
      // present, then text). Frontend's `ContentDisplay` walks this array
      // and routes `type:'thinking'` blocks into the "Show Thinking" panel
      // and `type:'text'` blocks into the answer body — same behavior v=1
      // gets natively. Preserves `signature` on thinking blocks so the
      // signature is available for opaque continuations.
      const contentBlocks: Array<Record<string, unknown>> = [];
      // Aggregated web-search citations across text blocks — surfaced at the
      // top level of the TalkToUser result so `AgentTurnContainer` can enrich
      // web_search results with cited_text.
      const allCitations: unknown[] = [];
      const blocks = Array.isArray(entry.content) ? entry.content : [];
      for (const block of blocks) {
        const t = (block as { type?: string }).type;
        if (t === 'thinking') {
          const tb = block as { thinking?: string; thinkingSignature?: string };
          const out: Record<string, unknown> = { type: 'thinking', thinking: tb.thinking ?? '' };
          if (tb.thinkingSignature) out.signature = tb.thinkingSignature;
          contentBlocks.push(out);
        } else if (t === 'text') {
          const tb = block as { text?: string; citations?: unknown[] };
          const out: Record<string, unknown> = { type: 'text', text: tb.text ?? '' };
          if (Array.isArray(tb.citations) && tb.citations.length > 0) {
            out.citations = tb.citations;
            allCitations.push(...tb.citations);
          }
          contentBlocks.push(out);
        } else if (t === 'web_search_tool_result') {
          // Native Anthropic web-search results — rendered as the "Browsing"
          // card in the timeline. Passed through unchanged.
          const wb = block as { tool_use_id?: string; content?: unknown };
          contentBlocks.push({ type: 'web_search_tool_result', tool_use_id: wb.tool_use_id, content: wb.content });
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
            ...(allCitations.length > 0 ? { citations: allCitations } : {}),
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
          args: (tc.arguments ?? {}) as Record<string, unknown>,
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

// ─── legacyLogToPi: reverse — seed a forked v2 chat from a v1 log ────

const SEED_USAGE: AssistantMessage['usage'] = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** Common provider metadata for seeded assistant messages (historical, never re-generated). */
function seedAssistantMeta(createdAt: string) {
  return {
    api: 'anthropic-messages' as AssistantMessage['api'],
    provider: 'anthropic',
    model: 'legacy',
    usage: SEED_USAGE,
    timestamp: Date.parse(createdAt) || 0,
  };
}

/** v1 content_blocks → pi assistant content. Thinking keeps its text but DROPS
 *  the signature (re-sending a v1 signature in a v2 native call is rejected). */
function legacyContentBlocksToPi(blocks: unknown[]): AssistantMessage['content'] {
  const out: AssistantMessage['content'] = [];
  for (const b of blocks) {
    const block = b as { type?: string; thinking?: string; text?: string; citations?: unknown[]; tool_use_id?: string; content?: unknown };
    if (block.type === 'thinking') {
      out.push({ type: 'thinking', thinking: block.thinking ?? '' } as ThinkingContent);
    } else if (block.type === 'text') {
      const t: TextContent = { type: 'text', text: block.text ?? '' };
      if (Array.isArray(block.citations) && block.citations.length > 0) {
        (t as { citations?: unknown }).citations = block.citations;
      }
      out.push(t);
    } else if (block.type === 'web_search_tool_result') {
      // Not in the AssistantMessage union (read defensively by piLogToLegacy) — cast.
      out.push({ type: 'web_search_tool_result', tool_use_id: block.tool_use_id, content: block.content } as unknown as TextContent);
    }
  }
  return out;
}

function parseResultObject(result: unknown): Record<string, unknown> | null {
  if (result && typeof result === 'object') return result as Record<string, unknown>;
  if (typeof result === 'string') {
    try { const p = JSON.parse(result); return p && typeof p === 'object' ? (p as Record<string, unknown>) : null; } catch { return null; }
  }
  return null;
}

function resultToText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result == null) return '';
  return JSON.stringify(result);
}

/**
 * Reverse translation: a v1 (legacy) conversation log → a v2 (pi)
 * ConversationLog, used to SEED a forked v2 conversation so an old chat can be
 * continued without data loss (the original v1 file is untouched).
 *
 * Per turn: the root `AnalystAgent` task → root AgentInvocation (carries the
 * user message); `TalkToUser` → the final assistant message (stopReason 'stop'
 * — the only thing projectRootThreadHistory sends to the LLM); tool tasks →
 * assistant `tool_use` + paired `tool_result` (stopReason 'toolUse', DISPLAY
 * only, never re-sent to the model). Thinking keeps its text, drops its
 * signature. Context is empty — these turns are history, never re-run.
 */
export function legacyLogToPi(legacyLog: LegacyLogEntry[]): ConversationLog {
  const out: ConversationLog = [];
  const resultByTaskId = new Map<string, TaskResultEntry>();
  for (const e of legacyLog) {
    if (e._type === 'task_result') resultByTaskId.set(e._task_unique_id, e);
  }

  let currentRootId: string | null = null;
  for (const e of legacyLog) {
    if (e._type !== 'task') continue;
    const task = e as TaskLogEntry;

    // Root user turn.
    if (task.agent === 'AnalystAgent' && !task._parent_unique_id) {
      currentRootId = task.unique_id;
      const userMessage = (task.args as { user_message?: unknown } | undefined)?.user_message;
      const invocation: AgentInvocation & { parent_id: string | null } = {
        type: 'toolCall',
        id: task.unique_id,
        name: 'WebAnalystAgent',
        arguments: { userMessage: typeof userMessage === 'string' ? userMessage : '' },
        context: {},
        parent_id: null,
      };
      out.push(invocation as unknown as PiLogEntry);
      continue;
    }

    const parentId = task._parent_unique_id ?? currentRootId ?? null;
    const result = resultByTaskId.get(task.unique_id);

    if (task.agent === 'TalkToUser') {
      // Final assistant reply — content_blocks live in the result (preferred) or args.
      const parsed = parseResultObject(result?.result);
      const fromResult = parsed && Array.isArray(parsed.content_blocks) ? (parsed.content_blocks as unknown[]) : null;
      const fromArgs = Array.isArray((task.args as { content_blocks?: unknown[] } | undefined)?.content_blocks)
        ? ((task.args as { content_blocks: unknown[] }).content_blocks)
        : null;
      const blocks = fromResult ?? fromArgs ?? [];
      const assistant: AssistantMessage & { parent_id: string | null } = {
        role: 'assistant',
        content: legacyContentBlocksToPi(blocks),
        stopReason: 'stop',
        parent_id: parentId,
        ...seedAssistantMeta(task.created_at),
      };
      out.push(assistant as unknown as PiLogEntry);
      continue;
    }

    // Tool task → assistant(tool_use) + paired tool_result (display only).
    const toolCall: PiToolCall = { type: 'toolCall', id: task.unique_id, name: task.agent, arguments: (task.args ?? {}) as Record<string, unknown> };
    const assistant: AssistantMessage & { parent_id: string | null } = {
      role: 'assistant',
      content: [toolCall],
      stopReason: 'toolUse',
      parent_id: parentId,
      ...seedAssistantMeta(task.created_at),
    };
    out.push(assistant as unknown as PiLogEntry);

    const details = (result?.details ?? {}) as Record<string, unknown>;
    const { success, ...restDetails } = details;
    const toolResult: ToolResultMessage & { parent_id: string | null } = {
      role: 'toolResult',
      toolCallId: task.unique_id,
      toolName: task.agent,
      content: [{ type: 'text', text: resultToText(result?.result) }],
      details: restDetails,
      isError: success === false,
      timestamp: Date.parse(task.created_at) || 0,
      parent_id: parentId,
    };
    out.push(toolResult as unknown as PiLogEntry);
  }

  return out;
}

// ─── piStreamEventToLegacy: streaming ────────────────────────────────

interface LegacyStreamingEvent {
  type: 'StreamedContent' | 'StreamedThinking' | 'ToolCreated' | 'ToolCompleted';
  payload: { chunk: string } | { id: string; type: 'function'; function: { name: string; arguments: Record<string, unknown> } } | CompletedToolCallResult;
  conversationID: number;
}

/**
 * Per-event SSE translation. Returns null for orchestrator events that have no
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
          arguments: (ev.toolCall.arguments ?? {}) as Record<string, unknown>,
        },
      },
      conversationID,
    };
  }

  // Internal/structural events that legacy doesn't model — skip.
  return null;
}

// NOTE: the read-path down-translation (`translateConversationForFrontend`) has been retired.
// v=2 conversation files now serve the orchestrator pi `ConversationLog` as-is; the frontend
// parses it pi-natively via `parsePiConversation` (which reuses `piLogToLegacy` internally for the
// render structs while additionally carrying each turn's appState/currentTime). `piLogToLegacy`
// is kept and exported because that internal reuse — and the benchmark page — still depend on it.

// ─── legacyToolResultToPi: reverse for resume ────────────────────────

/**
 * Reverse mapping for orchestrator `resume()` input. The frontend sends back
 * legacy `CompletedToolCallResult` shape; the orchestrator wants orchestrator
 * `ToolResultMessage`. Single-direction, no information loss for the fields
 * the orchestrator actually reads.
 */
export function legacyToolResultToPi(toolResult: CompletedToolCallResult): ToolResultMessage {
  const content = toolResultContentToPi(toolResult.content);
  const details = toolResult.details as { success?: boolean } | undefined;
  const isError = details ? details.success === false : false;
  return {
    role: 'toolResult',
    toolCallId: toolResult.tool_call_id,
    toolName: toolResult.function.name,
    content,
    isError,
    timestamp: Date.parse(toolResult.created_at) || 0,
    ...(toolResult.details ? { details: toolResult.details } : {}),
  };
}

/**
 * Convert a legacy tool-result `content` into the orchestrator's `(TextContent | ImageContent)[]`.
 *
 * A string (or non-array object) collapses to a single text block. An ARRAY is mapped block-by-block
 * so that image blocks SURVIVE: ReadFiles/ExecuteQuery/EditFile attach a rendered chart as an
 * OpenAI-style `image_url` block, which must become an orchestrator `image` block (data: URLs split
 * to `{data, mimeType}`) — collapsing the array into one JSON.stringify'd text block silently
 * destroyed the image, so the rendered chart never reached the LLM.
 */
function toolResultContentToPi(
  content: CompletedToolCallResult['content'],
): (TextContent | ImageContent)[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [{ type: 'text', text: JSON.stringify(content) }];
  return content.map((block): TextContent | ImageContent => {
    const b = block as Record<string, unknown>;
    if (b.type === 'image') return b as unknown as ImageContent;
    if (b.type === 'image_url') {
      const url = (b.image_url as { url?: string } | undefined)?.url ?? '';
      return imageContentFromUrl(url);
    }
    if (b.type === 'text' && typeof b.text === 'string') return { type: 'text', text: b.text };
    return { type: 'text', text: JSON.stringify(block) };
  });
}
