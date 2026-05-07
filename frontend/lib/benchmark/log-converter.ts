import type { ConversationLogEntry, TaskLogEntry, TaskResultEntry, TaskDebugEntry } from '@/lib/types';

// ── Orchestrator log → production log converter ─────────────────────────

/**
 * An orchestrator ConversationLog entry uses pi-ai types:
 * - AgentInvocation: { type: 'toolCall', id, name, arguments, context, parent_id: null }
 * - AssistantMessage: { role: 'assistant', content: [...], stopReason, usage, model, timestamp, parent_id }
 * - ToolResultMessage: { role: 'toolResult', toolCallId, toolName, content, isError, timestamp, parent_id }
 *
 * We don't import the actual pi-ai types here to avoid pulling in the orchestrator dependency.
 */
interface OrchestratorEntry {
  // AgentInvocation fields
  type?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  context?: Record<string, unknown>;
  // AssistantMessage / ToolResultMessage fields
  role?: string;
  content?: Array<{ type: string; text?: string; id?: string; name?: string; arguments?: Record<string, unknown> }>;
  stopReason?: string;
  usage?: Record<string, unknown>;
  model?: string;
  timestamp?: number;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  details?: Record<string, unknown>;
  // Shared
  parent_id?: string | null;
}

function toISO(ts?: number): string {
  return ts ? new Date(ts).toISOString() : new Date().toISOString();
}

let runCounter = 0;
function genRunId(): string {
  return `bmrun_${++runCounter}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Convert an orchestrator conversation log (pi-ai types) into the production
 * conversation log format (TaskLogEntry / TaskResultEntry / TaskDebugEntry)
 * so that `parseLogToMessages()` can render it in the chat UI.
 */

/** Map benchmark/orchestrator tool names to their production equivalents for proper UI rendering. */
const TOOL_NAME_MAP: Record<string, string> = {
  ExecuteSQL: 'ExecuteQuery',
  ListDBConnections: 'ReadFiles',
};

/** Map benchmark tool args to production arg shape so display components render correctly. */
function mapToolArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (name === 'ExecuteSQL') {
    return { query: args.sql, connectionId: args.connection };
  }
  return args;
}

function mapToolName(name: string): string {
  return TOOL_NAME_MAP[name] ?? name;
}

export function convertOrchestratorLog(orchLog: OrchestratorEntry[]): ConversationLogEntry[] {
  runCounter = 0;
  const out: ConversationLogEntry[] = [];
  const runId = genRunId();

  for (const entry of orchLog) {
    // AgentInvocation (root): type === 'toolCall' && parent_id === null
    if (entry.type === 'toolCall' && entry.parent_id === null) {
      const task: TaskLogEntry = {
        _type: 'task',
        _parent_unique_id: null,
        _previous_unique_id: null,
        _run_id: runId,
        agent: entry.name ?? 'UnknownAgent',
        args: {
          ...entry.arguments,
          // Map userMessage → goal so parseLogToMessages picks it up
          goal: (entry.arguments as Record<string, unknown>)?.userMessage,
        },
        unique_id: entry.id ?? genRunId(),
        created_at: toISO(entry.timestamp as number | undefined),
      };
      out.push(task);
      continue;
    }

    // AssistantMessage with tool calls
    if (entry.role === 'assistant' && entry.content) {
      const toolCalls = entry.content.filter(c => c.type === 'toolCall');
      const textParts = entry.content.filter(c => c.type === 'text').map(c => c.text ?? '').join('\n');
      const parentId = entry.parent_id ?? null;
      const entryRunId = genRunId();

      // Emit a TaskLogEntry for each tool call in this assistant message
      for (const tc of toolCalls) {
        const task: TaskLogEntry = {
          _type: 'task',
          _parent_unique_id: parentId,
          _previous_unique_id: null,
          _run_id: entryRunId,
          agent: mapToolName(tc.name ?? 'UnknownTool'),
          args: mapToolArgs(tc.name ?? '', tc.arguments ?? {}),
          unique_id: tc.id ?? genRunId(),
          created_at: toISO(entry.timestamp),
        };
        out.push(task);
      }

      // If this is the final reply (stopReason === 'stop' with text), emit TalkToUser
      if (entry.stopReason === 'stop' && textParts.length > 0) {
        const talkId = `talk_${genRunId()}`;
        const talkRunId = genRunId();
        const talkTask: TaskLogEntry = {
          _type: 'task',
          _parent_unique_id: parentId,
          _previous_unique_id: null,
          _run_id: talkRunId,
          agent: 'TalkToUser',
          args: { content_blocks: [{ type: 'text', text: textParts }] },
          unique_id: talkId,
          created_at: toISO(entry.timestamp),
        };
        out.push(talkTask);

        const talkResult: TaskResultEntry = {
          _type: 'task_result',
          _task_unique_id: talkId,
          result: JSON.stringify({
            success: true,
            content_blocks: [{ type: 'text', text: textParts }],
          }),
          created_at: toISO(entry.timestamp),
        };
        out.push(talkResult);
      }

      // Emit debug entry if there's usage info
      if (entry.usage && parentId) {
        const debug: TaskDebugEntry = {
          _type: 'task_debug',
          _task_unique_id: parentId,
          duration: 0,
          llmDebug: [{
            model: entry.model ?? 'unknown',
            ...entry.usage,
          }],
          created_at: toISO(entry.timestamp),
        };
        out.push(debug);
      }

      continue;
    }

    // ToolResultMessage
    if (entry.role === 'toolResult' && entry.toolCallId) {
      const result: TaskResultEntry = {
        _type: 'task_result',
        _task_unique_id: entry.toolCallId,
        result: entry.content?.map(c => c.text ?? '').join('\n') ?? null,
        created_at: toISO(entry.timestamp),
        ...(entry.details ? { details: entry.details as any } : {}),
      };
      out.push(result);
      continue;
    }
  }

  return out;
}
