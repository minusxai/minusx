import { Type } from '@sinclair/typebox';
import type { Model } from '@mariozechner/pi-ai';
import { Agent } from '../agent';
import { Task, type ConversationLogEntry } from '../conversation';
import { buildMessagesFromLog } from '../log-messages';
import { runAgent } from '../run-agent';
import { Tool } from '../tool';
import type { RunContext, ToolResult } from '../types';
import { MockStreamFn } from './mock-stream-fn';

// ============================================================================
// Test fixtures
// ============================================================================

class SimpleTool extends Tool<{ value: string }> {
  readonly name = 'simpleTool';
  readonly description = 'Returns a fixed result for the given value';
  readonly schema = Type.Object({
    value: Type.String({ description: 'The value to echo' }),
  });

  async run({ value }: { value: string }): Promise<ToolResult> {
    return { state: 'success', content: `Tool result: ${value}` };
  }
}

class TestAgent extends Agent {
  readonly name = 'testAgent';
  tools = [new SimpleTool()];
  systemPrompt(): string {
    return 'You are a test agent.';
  }
}

// Minimal model stub. The real `agentLoop` reads model.id/api/provider when calling
// streamFn. Our MockStreamFn copies these onto the synthesized AssistantMessage but
// otherwise doesn't care about model details.
const mockModel: Model<any> = {
  id: 'mock-model',
  name: 'Mock',
  api: 'openai-completions',
  provider: 'openai',
  baseUrl: 'http://mock',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as Model<any>;

const ctx: RunContext = { model: mockModel };

// ============================================================================
// Tests
// ============================================================================

describe('task_serialization', () => {
  it('Task object has correct field shapes with underscore-prefixed keys', () => {
    const task: Task = {
      _type: 'task',
      _parent_unique_id: null,
      _previous_unique_id: null,
      _run_id: 'test123',
      unique_id: 'unique123',
      agent: 'SimpleTool',
      args: { value: 'test' },
      created_at: new Date().toISOString(),
    };

    expect(task._type).toBe('task');
    expect(task._parent_unique_id).toBeNull();
    expect(task._run_id).toBe('test123');
    expect(task.agent).toBe('SimpleTool');
    expect(task.unique_id).toBe('unique123');
  });
});

describe('parallel_execution', () => {
  it('dispatches 3 tool calls in one turn and records all TaskResults', async () => {
    const mock = new MockStreamFn();
    // Turn 1: LLM returns 3 tool calls. Turn 2: LLM stops (no more tool calls).
    mock.configure([
      [
        { type: 'toolCall', id: 'tc-A', name: 'simpleTool', arguments: { value: 'A' } },
        { type: 'toolCall', id: 'tc-B', name: 'simpleTool', arguments: { value: 'B' } },
        { type: 'toolCall', id: 'tc-C', name: 'simpleTool', arguments: { value: 'C' } },
      ],
      [{ type: 'text', text: 'All done' }],
    ]);

    const { logDiff } = await runAgent(new TestAgent(), 'Run three tools', [], ctx, mock.asStreamFn());

    const tasks = logDiff.filter((e) => e._type === 'task');
    const results = logDiff.filter((e) => e._type === 'task_result');

    expect(tasks.length).toBe(4); // 1 root + 3 children
    expect(results.length).toBe(4); // 3 child results + 1 root result

    const childResults = results
      .filter((e): e is ConversationLogEntry & { _type: 'task_result' } => e._type === 'task_result')
      .filter((r) => r._task_unique_id !== tasks[0].unique_id)
      .map((r) => r.result as string)
      .sort();

    expect(childResults).toEqual(['Tool result: A', 'Tool result: B', 'Tool result: C']);

    const childTasks = tasks.filter(
      (e): e is ConversationLogEntry & { _type: 'task' } => e._type === 'task' && e._parent_unique_id !== null,
    );
    const runIds = new Set(childTasks.map((t) => t._run_id));
    expect(runIds.size).toBe(1);
  });
});

describe('multi_turn_previous_linking', () => {
  it('second runAgent call links root task to first via _previous_unique_id and reconstructs prior LLM history', async () => {
    const mock1 = new MockStreamFn();
    mock1.configure([
      [{ type: 'toolCall', id: 'tc-first', name: 'simpleTool', arguments: { value: 'first' } }],
      [{ type: 'text', text: 'First turn done' }],
    ]);

    const { logDiff: logDiff1 } = await runAgent(
      new TestAgent(),
      'First message',
      [],
      ctx,
      mock1.asStreamFn(),
    );

    const firstRootTask = logDiff1.find(
      (e): e is ConversationLogEntry & { _type: 'task' } =>
        e._type === 'task' && e._parent_unique_id === null,
    );
    expect(firstRootTask).toBeDefined();
    expect(firstRootTask!._previous_unique_id).toBeNull();

    const mock2 = new MockStreamFn();
    mock2.configure([[{ type: 'text', text: 'Second turn done' }]]);

    const { logDiff: logDiff2 } = await runAgent(
      new TestAgent(),
      'Second message',
      logDiff1,
      ctx,
      mock2.asStreamFn(),
    );

    const secondRootTask = logDiff2.find(
      (e): e is ConversationLogEntry & { _type: 'task' } =>
        e._type === 'task' && e._parent_unique_id === null,
    );
    expect(secondRootTask).toBeDefined();
    expect(secondRootTask!._previous_unique_id).toBe(firstRootTask!.unique_id);
  });
});

describe('agent + tool integration', () => {
  it('runs an agents/ Tool (CannotAnswer) end-to-end through real agentLoop + mock LLM', async () => {
    const { CannotAnswer } = await import('../../../agents/src/analyst/tools/cannot-answer');

    class MiniAgent extends Agent {
      readonly name = 'MiniAgent';
      tools = [new CannotAnswer()];
      systemPrompt(): string {
        return 'You are a test agent.';
      }
    }

    const mock = new MockStreamFn();
    mock.configure([
      [{ type: 'toolCall', id: 'tc-cannot', name: 'CannotAnswer', arguments: { reason: 'insufficient data' } }],
      [{ type: 'text', text: 'OK' }],
    ]);

    const { logDiff } = await runAgent(new MiniAgent(), 'Compute X', [], ctx, mock.asStreamFn());

    const childResults = logDiff
      .filter((e): e is ConversationLogEntry & { _type: 'task_result' } => e._type === 'task_result')
      .filter((r) => {
        const childTask = logDiff.find(
          (e): e is ConversationLogEntry & { _type: 'task' } =>
            e._type === 'task' && e.unique_id === r._task_unique_id && e._parent_unique_id !== null,
        );
        return childTask !== undefined;
      });

    expect(childResults.length).toBe(1);
    const result = childResults[0].result as { submitted: boolean; cannot_answer: boolean; reason: string };
    expect(result.submitted).toBe(true);
    expect(result.cannot_answer).toBe(true);
    expect(result.reason).toBe('insufficient data');
  });
});

describe('runAgent result discriminated union', () => {
  it('returns { state: "success", content, logDiff } when the agent completes', async () => {
    const mock = new MockStreamFn();
    mock.configure([[{ type: 'text', text: 'all done' }]]);
    const result = await runAgent(new TestAgent(), 'Hi', [], ctx, mock.asStreamFn());
    expect(result.state).toBe('success');
    if (result.state === 'success') {
      expect(result.content).toBe('all done');
      expect(result.logDiff.length).toBeGreaterThan(0);
    }
  });

  it('returns { state: "pending", pendingTools } when a tool returns pending', async () => {
    class PendingClarify extends Tool<{ question: string }> {
      readonly name = 'PendingClarify';
      readonly description = 'Pauses for user input';
      readonly schema = Type.Object({ question: Type.String() });
      async run({ question }: { question: string }): Promise<ToolResult> {
        return { state: 'pending', pending: { question, options: ['a', 'b'] } };
      }
    }

    class PauseAgent extends Agent {
      readonly name = 'PauseAgent';
      tools = [new PendingClarify()];
      systemPrompt(): string { return 'You ask for clarification.'; }
    }

    const mock = new MockStreamFn();
    mock.configure([
      [{ type: 'toolCall', id: 'tc-clarify', name: 'PendingClarify', arguments: { question: 'Which one?' } }],
    ]);

    const result = await runAgent(new PauseAgent(), 'do thing', [], ctx, mock.asStreamFn());
    expect(result.state).toBe('pending');
    if (result.state === 'pending') {
      expect(result.pendingTools.length).toBe(1);
      expect(result.pendingTools[0].toolName).toBe('PendingClarify');
      expect(result.pendingTools[0].pending).toEqual({ question: 'Which one?', options: ['a', 'b'] });

      const taskResults = result.logDiff.filter((e) => e._type === 'task_result');
      const taskIds = new Set(taskResults.map((r) => (r as { _task_unique_id: string })._task_unique_id));
      expect(taskIds.has(result.pendingTools[0].toolCallId)).toBe(false);
    }
  });

  it('records state: "failure" tool results as errors in the log', async () => {
    class FailingTool extends Tool<Record<string, never>> {
      readonly name = 'FailingTool';
      readonly description = 'Always fails';
      readonly schema = Type.Object({});
      async run(): Promise<ToolResult> {
        return { state: 'failure', error: 'expected failure for testing' };
      }
    }

    class FailAgent extends Agent {
      readonly name = 'FailAgent';
      tools = [new FailingTool()];
      systemPrompt(): string { return 'You always fail.'; }
    }

    const mock = new MockStreamFn();
    mock.configure([
      [{ type: 'toolCall', id: 'tc-fail', name: 'FailingTool', arguments: {} }],
      [{ type: 'text', text: 'tried but failed' }],
    ]);

    const result = await runAgent(new FailAgent(), 'go', [], ctx, mock.asStreamFn());
    expect(result.state).toBe('success');
    const childResult = result.logDiff
      .filter((e) => e._type === 'task_result')
      .map((r) => (r as { result: unknown }).result)
      .find((r) => r && typeof r === 'object' && 'error' in r);
    expect(childResult).toEqual({ error: 'expected failure for testing' });
  });
});

describe('buildMessagesFromLog', () => {
  it('returns empty array for empty log', () => {
    expect(buildMessagesFromLog([])).toEqual([]);
  });

  it('reconstructs full message sequence from a multi-tool log', async () => {
    const mock = new MockStreamFn();
    mock.configure([
      [
        { type: 'toolCall', id: 'tc-x', name: 'simpleTool', arguments: { value: 'X' } },
        { type: 'toolCall', id: 'tc-y', name: 'simpleTool', arguments: { value: 'Y' } },
      ],
      [{ type: 'text', text: 'Done with two tools' }],
    ]);

    const { logDiff } = await runAgent(new TestAgent(), 'Hello', [], ctx, mock.asStreamFn());
    const messages = buildMessagesFromLog(logDiff);

    // user, assistant(2 toolCalls), toolResult x2, assistant(text)
    expect(messages.length).toBe(5);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect((messages[1] as { content: unknown[] }).content.length).toBe(2);
    expect(messages[2].role).toBe('toolResult');
    expect(messages[3].role).toBe('toolResult');
    expect(messages[4].role).toBe('assistant');
  });
});
