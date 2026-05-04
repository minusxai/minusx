import { Type } from '@sinclair/typebox';
import type { AgentContext } from '@mariozechner/pi-agent-core';
import { Agent } from '../agent';
import { Task, type ConversationLogEntry } from '../conversation';
import { buildMessagesFromLog } from '../log-messages';
import { runAgent } from '../run-agent';
import { Tool } from '../tool';
import type { RunContext } from '../types';
import { MockAgentLoop } from './mock-agent-loop';

// ============================================================================
// Test fixtures
// ============================================================================

class SimpleTool extends Tool<{ value: string }> {
  readonly name = 'simpleTool';
  readonly description = 'Returns a fixed result for the given value';
  readonly schema = Type.Object({
    value: Type.String({ description: 'The value to echo' }),
  });

  async run({ value }: { value: string }): Promise<string> {
    return `Tool result: ${value}`;
  }
}

class TestAgent extends Agent {
  readonly name = 'testAgent';
  tools = [new SimpleTool()];
  systemPrompt(): string {
    return 'You are a test agent.';
  }
}

const ctx: RunContext = {};

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
    const mock = new MockAgentLoop();
    mock.configure([
      {
        toolCalls: [
          { name: 'simpleTool', args: { value: 'A' } },
          { name: 'simpleTool', args: { value: 'B' } },
          { name: 'simpleTool', args: { value: 'C' } },
        ],
        reply: 'All done',
      },
    ]);

    const { logDiff } = await runAgent(new TestAgent(), 'Run three tools', [], ctx, mock.asLoopFn());

    // Should have: 1 root Task + 3 child Tasks + 3 child TaskResults + 1 root TaskResult
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

    // All 3 child tasks share the same run_id (same LLM turn / batch)
    const childTasks = tasks.filter(
      (e): e is ConversationLogEntry & { _type: 'task' } => e._type === 'task' && e._parent_unique_id !== null,
    );
    const runIds = new Set(childTasks.map((t) => t._run_id));
    expect(runIds.size).toBe(1);
  });
});

describe('multi_turn_previous_linking', () => {
  it('second runAgent call links root task to first via _previous_unique_id and reconstructs prior LLM history', async () => {
    const mock1 = new MockAgentLoop();
    mock1.configure([
      {
        toolCalls: [{ name: 'simpleTool', args: { value: 'first' } }],
        reply: 'First turn done',
      },
    ]);

    const { logDiff: logDiff1 } = await runAgent(
      new TestAgent(),
      'First message',
      [],
      ctx,
      mock1.asLoopFn(),
    );

    const firstRootTask = logDiff1.find(
      (e): e is ConversationLogEntry & { _type: 'task' } =>
        e._type === 'task' && e._parent_unique_id === null,
    );
    expect(firstRootTask).toBeDefined();
    expect(firstRootTask!._previous_unique_id).toBeNull();

    // Capture what the second turn's MockAgentLoop receives as its prior context.
    let capturedContext: AgentContext | undefined;
    const mock2 = new MockAgentLoop();
    mock2.configure([{ reply: 'Second turn done' }]);
    const innerLoopFn = mock2.asLoopFn();
    const wrappedLoopFn: typeof innerLoopFn = (prompts, context, config, signal) => {
      capturedContext = context;
      return innerLoopFn(prompts, context, config, signal);
    };

    const { logDiff: logDiff2 } = await runAgent(
      new TestAgent(),
      'Second message',
      logDiff1,
      ctx,
      wrappedLoopFn,
    );

    // _previous_unique_id linking
    const secondRootTask = logDiff2.find(
      (e): e is ConversationLogEntry & { _type: 'task' } =>
        e._type === 'task' && e._parent_unique_id === null,
    );
    expect(secondRootTask).toBeDefined();
    expect(secondRootTask!._previous_unique_id).toBe(firstRootTask!.unique_id);

    // Prior LLM history reconstructed from the log: user -> assistant(toolCall) -> toolResult -> assistant(text)
    expect(capturedContext).toBeDefined();
    const priorMessages = capturedContext!.messages;

    expect(priorMessages.length).toBe(4);

    expect(priorMessages[0].role).toBe('user');
    expect((priorMessages[0] as { content: { text: string }[] }).content[0].text).toBe('First message');

    expect(priorMessages[1].role).toBe('assistant');
    const assistantToolUse = priorMessages[1] as { content: { type: string; name?: string; arguments?: Record<string, unknown> }[] };
    expect(assistantToolUse.content[0].type).toBe('toolCall');
    expect(assistantToolUse.content[0].name).toBe('simpleTool');
    expect(assistantToolUse.content[0].arguments).toEqual({ value: 'first' });

    expect(priorMessages[2].role).toBe('toolResult');
    expect((priorMessages[2] as { content: { text: string }[] }).content[0].text).toBe('Tool result: first');

    expect(priorMessages[3].role).toBe('assistant');
    const finalAssistant = priorMessages[3] as { content: { type: string; text?: string }[] };
    expect(finalAssistant.content[0].type).toBe('text');
    expect(finalAssistant.content[0].text).toBe('First turn done');
  });
});

describe('buildMessagesFromLog', () => {
  it('returns empty array for empty log', () => {
    expect(buildMessagesFromLog([])).toEqual([]);
  });

  it('reconstructs full message sequence from a multi-tool log', async () => {
    const mock = new MockAgentLoop();
    mock.configure([
      {
        toolCalls: [
          { name: 'simpleTool', args: { value: 'X' } },
          { name: 'simpleTool', args: { value: 'Y' } },
        ],
        reply: 'Done with two tools',
      },
    ]);

    const { logDiff } = await runAgent(new TestAgent(), 'Hello', [], ctx, mock.asLoopFn());
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
