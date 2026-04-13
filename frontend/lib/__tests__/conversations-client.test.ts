import { extractDebugMessages, parseLogToMessages } from '../conversations-client';
import type { ConversationLogEntry } from '../types';

describe('extractDebugMessages', () => {
  it('returns empty array for empty log', () => {
    expect(extractDebugMessages([])).toEqual([]);
  });

  it('returns empty array when no task_debug entries present', () => {
    const log: ConversationLogEntry[] = [
      {
        _type: 'task',
        unique_id: 'task-1',
        _run_id: 'run-1',
        _parent_unique_id: null,
        agent: 'AnalystAgent',
        args: { goal: 'hello' },
        created_at: '2024-01-01T00:00:00Z',
      }
    ];
    expect(extractDebugMessages(log)).toEqual([]);
  });

  it('extracts a single task_debug entry as a debug message', () => {
    const log: ConversationLogEntry[] = [
      {
        _type: 'task_debug',
        _task_unique_id: 'task-1',
        duration: 1.5,
        llmDebug: [{ model: 'claude-sonnet-4', duration: 1.2, total_tokens: 100, prompt_tokens: 80, completion_tokens: 20, cost: 0.001 }],
        created_at: '2024-01-01T00:00:00Z',
      }
    ];

    const result = extractDebugMessages(log);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      role: 'debug',
      task_unique_id: 'task-1',
      duration: 1.5,
      llmDebug: [expect.objectContaining({ model: 'claude-sonnet-4' })],
      created_at: '2024-01-01T00:00:00Z',
    });
  });

  it('aggregates multiple task_debug entries for the same task (sums duration, concatenates llmDebug)', () => {
    const log: ConversationLogEntry[] = [
      {
        _type: 'task_debug',
        _task_unique_id: 'task-1',
        duration: 1.0,
        llmDebug: [{ model: 'claude-sonnet-4', duration: 0.8, total_tokens: 100, prompt_tokens: 80, completion_tokens: 20, cost: 0.001 }],
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        _type: 'task_debug',
        _task_unique_id: 'task-1',
        duration: 0.5,
        llmDebug: [{ model: 'claude-sonnet-4', duration: 0.4, total_tokens: 50, prompt_tokens: 40, completion_tokens: 10, cost: 0.0005 }],
        created_at: '2024-01-01T00:00:01Z',
      }
    ];

    const result = extractDebugMessages(log);
    expect(result).toHaveLength(1);
    expect(result[0].task_unique_id).toBe('task-1');
    expect(result[0].duration).toBeCloseTo(1.5);
    expect(result[0].llmDebug).toHaveLength(2);
  });

  it('returns one debug message per task in encounter order', () => {
    const log: ConversationLogEntry[] = [
      {
        _type: 'task_debug',
        _task_unique_id: 'task-1',
        duration: 1.0,
        llmDebug: [],
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        _type: 'task_debug',
        _task_unique_id: 'task-2',
        duration: 2.0,
        llmDebug: [],
        created_at: '2024-01-01T00:00:01Z',
      },
    ];

    const result = extractDebugMessages(log);
    expect(result).toHaveLength(2);
    expect(result[0].task_unique_id).toBe('task-1');
    expect(result[1].task_unique_id).toBe('task-2');
  });

  it('preserves extra field from first debug entry for a task', () => {
    const log: ConversationLogEntry[] = [
      {
        _type: 'task_debug',
        _task_unique_id: 'task-1',
        duration: 1.0,
        llmDebug: [],
        extra: { someKey: 'someValue' },
        created_at: '2024-01-01T00:00:00Z',
      }
    ];

    const result = extractDebugMessages(log);
    expect(result[0].extra).toEqual({ someKey: 'someValue' });
  });
});

// ── parseLogToMessages ────────────────────────────────────────────────────────

const makeTask = (id: string, goal: string, at: string): ConversationLogEntry => ({
  _type: 'task',
  unique_id: id,
  _run_id: 'run-1',
  _parent_unique_id: null,
  agent: 'AnalystAgent',
  args: { goal },
  created_at: at,
});

const makeTaskResult = (taskId: string, at: string): ConversationLogEntry => ({
  _type: 'task_result',
  _task_unique_id: taskId,
  result: 'done',
  created_at: at,
});

describe('parseLogToMessages — logIndex on user messages', () => {
  it('sets logIndex to the array index of the task entry in the log', () => {
    const log: ConversationLogEntry[] = [
      makeTask('task-1', 'hello', '2024-01-01T00:00:00Z'),
      makeTaskResult('task-1', '2024-01-01T00:00:01Z'),
    ];

    const messages = parseLogToMessages(log);
    const userMsgs = messages.filter((m: any) => m.role === 'user');
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0].logIndex).toBe(0); // task is at log[0]
    expect(userMsgs[0].content).toBe('hello');
  });

  it('sets correct logIndex for the second user message in a multi-turn conversation', () => {
    const log: ConversationLogEntry[] = [
      makeTask('task-1', 'first message', '2024-01-01T00:00:00Z'),   // index 0
      makeTaskResult('task-1', '2024-01-01T00:00:01Z'),               // index 1
      makeTask('task-2', 'second message', '2024-01-01T00:00:02Z'),  // index 2
      makeTaskResult('task-2', '2024-01-01T00:00:03Z'),               // index 3
    ];

    const messages = parseLogToMessages(log);
    const userMsgs = messages.filter((m: any) => m.role === 'user');
    expect(userMsgs).toHaveLength(2);
    expect(userMsgs[0].logIndex).toBe(0);
    expect(userMsgs[1].logIndex).toBe(2);
  });

  it('does not set logIndex on non-user messages', () => {
    const log: ConversationLogEntry[] = [
      makeTask('task-1', 'hello', '2024-01-01T00:00:00Z'),
      makeTaskResult('task-1', '2024-01-01T00:00:01Z'),
    ];

    const messages = parseLogToMessages(log);
    const toolMsgs = messages.filter((m: any) => m.role === 'tool');
    toolMsgs.forEach((m: any) => {
      expect(m.logIndex).toBeUndefined();
    });
  });
});
