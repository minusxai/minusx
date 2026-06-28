// streamed-tool-calls — turn committed pi-log entries that arrive mid-stream into the
// `CompletedToolCall` shape the chat UI renders live. The v3 stream emits each committed message
// (assistant tool_use + the tool_result), but the running UI only consumed text deltas — so SERVER
// tool calls (ExecuteQuery / SearchDBSchema / SearchFiles) didn't appear until the turn settled and
// the full log reloaded. Feeding these into `streamedCompletedToolCalls` (via a `ToolCompleted`
// streaming event) makes them show as they execute.
//
// Pure + deterministic so it's unit-testable without the browser stream.

import type { CompletedToolCall } from '@/store/chatSlice';
import { immutableSet } from '@/lib/utils/immutable-collections';

export interface ToolCallMeta {
  name: string;
  arguments: Record<string, unknown>;
}

// Tool results that are NOT rendered as their own row: their text reply already streams as deltas.
const NON_ROW_TOOLS = immutableSet(['TalkToUser', 'AgentResponse']);

function isAssistant(c: unknown): c is { role: 'assistant'; content?: unknown[] } {
  return !!c && typeof c === 'object' && (c as { role?: string }).role === 'assistant';
}

function isToolResult(c: unknown): c is {
  role: 'toolResult';
  toolCallId: string;
  toolName?: string;
  content?: unknown;
  details?: Record<string, unknown>;
  isError?: boolean;
  timestamp?: number;
} {
  return !!c && typeof c === 'object' && (c as { role?: string }).role === 'toolResult';
}

function pickText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b): b is { type: 'text'; text: string } => (b as { type?: string })?.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/** Collect `id → {name, arguments}` for every `toolCall` block in a committed assistant message.
 *  The result entry alone lacks the args the display needs, so they're tracked here and paired in. */
export function collectToolCallMeta(content: unknown): Map<string, ToolCallMeta> {
  const map = new Map<string, ToolCallMeta>();
  if (!isAssistant(content) || !Array.isArray(content.content)) return map;
  for (const block of content.content) {
    const b = block as { type?: string; id?: string; name?: string; arguments?: unknown };
    if (b.type === 'toolCall' && b.id && b.name) {
      map.set(b.id, { name: b.name, arguments: (b.arguments ?? {}) as Record<string, unknown> });
    }
  }
  return map;
}

/** Build the live `CompletedToolCall` for a committed server-tool result, or null if `content`
 *  isn't a renderable tool result (assistant message, root invocation, or a text-reply tool). */
export function piToolResultToStreamedCall(
  content: unknown,
  meta: ToolCallMeta | undefined,
): CompletedToolCall | null {
  if (!isToolResult(content)) return null;
  const name = meta?.name ?? content.toolName;
  if (!name || NON_ROW_TOOLS.has(name)) return null;
  return {
    role: 'tool',
    tool_call_id: content.toolCallId,
    content: pickText(content.content),
    run_id: `run-${content.toolCallId}`,
    function: { name, arguments: JSON.stringify(meta?.arguments ?? {}) },
    created_at: new Date(typeof content.timestamp === 'number' ? content.timestamp : Date.now()).toISOString(),
    details: { ...(content.details ?? {}), success: !content.isError },
  };
}
