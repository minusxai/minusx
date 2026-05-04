export interface Task {
  _type: 'task';
  _parent_unique_id: string | null;
  _previous_unique_id: string | null;
  _run_id: string;
  unique_id: string;
  agent: string;
  args: Record<string, unknown>;
  created_at: string;
}

export interface TaskResult {
  _type: 'task_result';
  _task_unique_id: string;
  result: unknown;
  details?: unknown;
  created_at: string;
}

/**
 * Stats for a single LLM API call. Mirrors Python `LLMDebug` in `tasks/debug_context.py`.
 * One entry per `streamFn` invocation (= one LLM turn).
 */
export interface LLMDebug {
  /** Model id (e.g. 'claude-sonnet-4-6') */
  model: string;
  /** LLM provider's response/call id (analogous to Python's call_id). May be missing for some providers. */
  responseId?: string;
  /** Wall-clock duration of this LLM call in seconds */
  duration: number;
  /** Why the LLM stopped this turn ('stop' | 'length' | 'toolUse' | 'error' | 'aborted') */
  finishReason: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
}

export interface TaskDebugLog {
  _type: 'task_debug';
  _task_unique_id: string;
  /** Total wall-clock duration of the task in seconds (covers all LLM turns + tool execution). */
  duration: number;
  /** Per-turn LLM stats, in order. */
  llmDebug: LLMDebug[];
  extra?: unknown;
  created_at: string;
}

export type ConversationLogEntry = Task | TaskResult | TaskDebugLog;

export class CompressedTask {
  parent_unique_id: string | null;
  previous_unique_id: string | null;
  run_id: string;
  agent: string;
  args: Record<string, unknown>;
  unique_id: string;
  result: unknown = null;
  child_unique_ids: string[][] = [];

  constructor(opts: {
    parent_unique_id: string | null;
    previous_unique_id: string | null;
    run_id: string;
    agent: string;
    args: Record<string, unknown>;
    unique_id: string;
  }) {
    this.parent_unique_id = opts.parent_unique_id;
    this.previous_unique_id = opts.previous_unique_id;
    this.run_id = opts.run_id;
    this.agent = opts.agent;
    this.args = opts.args;
    this.unique_id = opts.unique_id;
  }
}

export function getLatestRootTask(log: ConversationLogEntry[]): Task | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (entry._type === 'task' && entry._parent_unique_id === null) {
      return entry;
    }
  }
  return null;
}

export class CompressedConversationLog {
  tasks: Map<string, CompressedTask> = new Map();
  log: ConversationLogEntry[] = [];
  private logStartIndex: number = 0;

  constructor(existingLog?: ConversationLogEntry[]) {
    if (existingLog && existingLog.length > 0) {
      this.rebuildFromLog(existingLog);
    }
  }

  private rebuildFromLog(log: ConversationLogEntry[]): void {
    this.log = [...log];
    this.logStartIndex = log.length;

    for (const entry of log) {
      if (entry._type === 'task') {
        const task = new CompressedTask({
          parent_unique_id: entry._parent_unique_id,
          previous_unique_id: entry._previous_unique_id,
          run_id: entry._run_id,
          agent: entry.agent,
          args: entry.args,
          unique_id: entry.unique_id,
        });
        this.tasks.set(task.unique_id, task);
      } else if (entry._type === 'task_result') {
        const task = this.tasks.get(entry._task_unique_id);
        if (task) {
          task.result = entry.result;
        }
      }
    }

    // Rebuild child_unique_ids
    for (const [, task] of this.tasks) {
      if (task.parent_unique_id !== null) {
        const parent = this.tasks.get(task.parent_unique_id);
        if (parent) {
          // Group by run_id
          let placed = false;
          for (const batch of parent.child_unique_ids) {
            const firstTask = this.tasks.get(batch[0]);
            if (firstTask && firstTask.run_id === task.run_id) {
              batch.push(task.unique_id);
              placed = true;
              break;
            }
          }
          if (!placed) {
            parent.child_unique_ids.push([task.unique_id]);
          }
        }
      }
    }
  }

  addTask(task: CompressedTask): void {
    this.tasks.set(task.unique_id, task);
    this.log.push({
      _type: 'task',
      _parent_unique_id: task.parent_unique_id,
      _previous_unique_id: task.previous_unique_id,
      _run_id: task.run_id,
      unique_id: task.unique_id,
      agent: task.agent,
      args: task.args,
      created_at: new Date().toISOString(),
    });
  }

  assignResult(taskUniqueId: string, result: unknown): void {
    const task = this.tasks.get(taskUniqueId);
    if (task) {
      task.result = result;
    }
    this.log.push({
      _type: 'task_result',
      _task_unique_id: taskUniqueId,
      result,
      created_at: new Date().toISOString(),
    });
  }

  /**
   * Append a TaskDebugLog entry for `taskUniqueId` (typically the root task) with
   * total duration and per-LLM-call stats. Mirrors Python `add_debug` in
   * `tasks/orchestrator.py`.
   */
  addDebug(taskUniqueId: string, duration: number, llmDebug: LLMDebug[]): void {
    this.log.push({
      _type: 'task_debug',
      _task_unique_id: taskUniqueId,
      duration,
      llmDebug,
      created_at: new Date().toISOString(),
    });
  }

  getLogDiff(): ConversationLogEntry[] {
    return this.log.slice(this.logStartIndex);
  }
}
