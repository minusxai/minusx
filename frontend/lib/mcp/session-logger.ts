/**
 * MCP Session Logger
 *
 * Records tool calls made during an MCP session and writes them to a
 * conversation file when the session closes. This makes MCP activity
 * visible in the standard conversation view for debugging.
 *
 * Design:
 * - Entries are buffered in memory during the session (MCP sessions are short-lived)
 * - The conversation file is written once, on session close
 * - No file is created if no tools were called (e.g., auth-only probes)
 * - Uses the same TaskLogEntry/TaskResultEntry format as the chat orchestrator,
 *   so the existing conversation viewer renders them without modification
 */

import 'server-only';
import { randomUUID } from 'crypto';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { appEventRegistry, AppEvents } from '@/lib/app-event-registry';
import { FilesAPI } from '@/lib/data/files.server';
import { resolvePath } from '@/lib/mode/path-resolver';
import type {
  ConversationFileContent,
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
   * Write the buffered session log to a conversation file.
   * Called on session close — fire-and-forget from the route handler.
   * Silently no-ops if no tools were called.
   */
  async flush(): Promise<void> {
    if (this.entries.length === 0) return;

    try {
      const userId = this.user.userId?.toString() ?? this.user.email;
      const path = resolvePath(
        this.user.mode,
        `/logs/conversations/${userId}/mcp-${this.sessionId}`,
      );
      const name = `mcp-${this.sessionId.slice(0, 8)}`;
      const source: ConversationSource = { type: 'mcp', sessionId: this.sessionId };
      const now = new Date().toISOString();

      const content: ConversationFileContent = {
        metadata: {
          userId,
          name,
          createdAt: this.startedAt,
          updatedAt: now,
          logLength: this.entries.length,
          source,
        },
        log: this.entries,
      };

      await FilesAPI.createFile(
        { name, path, type: 'conversation', content: content as any, options: { createPath: true } },
        this.user,
      );
    } catch {
      // Logging must never affect MCP tool responses
    }
  }
}
