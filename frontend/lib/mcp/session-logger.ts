/**
 * MCP Session Logger
 *
 * Records tool calls made during an MCP session and writes them to a v3
 * conversation when the session closes. This makes MCP activity visible in the
 * standard conversation view for debugging.
 *
 * Design:
 * - Entries are buffered in memory during the session (MCP sessions are short-lived)
 * - A v3 conversation is written once, on session close
 * - Nothing is created if no tools were called (e.g., auth-only probes)
 * - Tool calls are buffered as legacy TaskLogEntry/TaskResultEntry, then converted to the
 *   pi log shape via `legacyLogToPi` (same converter the backfill uses) and stored as
 *   `messages` rows — so MCP sessions are real v3 conversations, no file-conversation surface.
 */

import 'server-only';
import { randomUUID } from 'crypto';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import { legacyLogToPi } from '@/lib/chat-translator';
import { createConversation, appendMessages } from '@/lib/data/conversations.server';
import type { ConversationLog } from '@/orchestrator/types';
import type {
  ConversationLogEntry,
  ConversationSource,
  TaskLogEntry,
  TaskResultEntry,
} from '@/lib/types';
import type { McpToolCallResult } from './server';

export class McpSessionLogger {
  private readonly sessionId: string;
  private readonly user: EffectiveUser;
  private readonly startedAt: string;
  private readonly entries: (TaskLogEntry | TaskResultEntry)[] = [];

  constructor(sessionId: string, user: EffectiveUser) {
    this.sessionId = sessionId;
    this.user = user;
    this.startedAt = new Date().toISOString();
  }

  /**
   * Record a single tool invocation synchronously.
   * Called from the tool handler immediately after the tool returns.
   */
  logToolCall(tool: string, args: Record<string, unknown>, result: McpToolCallResult): void {
    const now = new Date().toISOString();
    const taskId = randomUUID();
    const runId = randomUUID();

    const taskEntry: TaskLogEntry = {
      _type: 'task',
      _parent_unique_id: null,
      _previous_unique_id: null,
      _run_id: runId,
      agent: tool,
      args,
      unique_id: taskId,
      created_at: now,
    };

    const resultEntry: TaskResultEntry = {
      _type: 'task_result',
      _task_unique_id: taskId,
      result,
      created_at: now,
    };

    this.entries.push(taskEntry, resultEntry);

    appEventRegistry.publish(AppEvents.MCP_TOOL_CALL, {
      sessionId: this.sessionId,
      tool,
      userId: this.user.userId,
      userEmail: this.user.email,
      mode: this.user.mode,
    });
  }

  /**
   * Write the buffered session log as a v3 conversation.
   * Called on session close — fire-and-forget from the route handler.
   * Silently no-ops if no tools were called.
   */
  async flush(): Promise<void> {
    if (this.entries.length === 0) return;

    try {
      const name = `mcp-${this.sessionId.slice(0, 8)}`;
      const source: ConversationSource = { type: 'mcp', sessionId: this.sessionId };
      // Convert the buffered legacy task-log to the pi shape v3 messages store.
      const piLog = legacyLogToPi(this.entries as unknown as ConversationLogEntry[]) as unknown as ConversationLog;

      const conv = await createConversation({
        ownerUserId: this.user.userId,
        mode: this.user.mode,
        agent: 'McpSession',
        title: name,
        meta: { source, startedAt: this.startedAt },
      });
      if (piLog.length > 0) await appendMessages(conv.id, piLog, 0);
    } catch {
      // Logging must never affect MCP tool responses
    }
  }
}
