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

describe('resume path: pending → inject result → continue', () => {
  // A tool that always returns pending. Frontend would render UI for the user;
  // here we'll skip that and inject the answer directly into the log.
  class PendingClarify extends Tool<{ question: string }> {
    readonly name = 'PendingClarify';
    readonly description = 'Pauses for user input';
    readonly schema = Type.Object({ question: Type.String() });
    async run({ question }: { question: string }): Promise<ToolResult> {
      return { state: 'pending', pending: { question } };
    }
  }

  class ResumableAgent extends Agent {
    readonly name = 'ResumableAgent';
    tools = [new PendingClarify()];
    systemPrompt(): string { return 'You ask for clarification when needed.'; }
  }

  it('round-trips pending → resume, with correctly-shaped Task entries throughout', async () => {
    // ── Turn 1: LLM calls PendingClarify ─────────────────────────────────────
    const mock1 = new MockStreamFn();
    mock1.configure([
      [{ type: 'toolCall', id: 'tc-clarify', name: 'PendingClarify', arguments: { question: 'A or B?' } }],
    ]);

    const result1 = await runAgent(new ResumableAgent(), 'Decide for me', [], ctx, mock1.asStreamFn());

    // Result is pending with the right pending payload
    expect(result1.state).toBe('pending');
    if (result1.state !== 'pending') return;
    expect(result1.pendingTools).toEqual([
      {
        toolCallId: 'tc-clarify',
        toolName: 'PendingClarify',
        args: { question: 'A or B?' },
        pending: { question: 'A or B?' },
      },
    ]);

    // Task entries in the log have correct shape — this replaces the old
    // synthetic task_serialization test by exercising real runAgent output.
    const tasksAfterTurn1 = result1.logDiff.filter(
      (e): e is Task => e._type === 'task',
    );
    expect(tasksAfterTurn1.length).toBe(2); // root + child clarify

    const rootR1 = tasksAfterTurn1.find((t) => t._parent_unique_id === null)!;
    expect(rootR1._type).toBe('task');
    expect(rootR1._previous_unique_id).toBeNull();
    expect(rootR1.agent).toBe('ResumableAgent');
    expect(rootR1.args).toMatchObject({ _user_message: 'Decide for me' });
    expect(typeof rootR1._run_id).toBe('string');
    expect(typeof rootR1.unique_id).toBe('string');
    expect(typeof rootR1.created_at).toBe('string');

    const childC1 = tasksAfterTurn1.find((t) => t._parent_unique_id === rootR1.unique_id)!;
    expect(childC1.unique_id).toBe('tc-clarify'); // deterministic mock id
    expect(childC1.agent).toBe('PendingClarify');
    expect(childC1.args).toEqual({ question: 'A or B?' });
    expect(childC1._run_id).not.toBe(rootR1._run_id); // child has its own batch run_id

    // Pending task has NO TaskResult — neither child nor root
    const taskResultIds = new Set(
      result1.logDiff
        .filter((e): e is ConversationLogEntry & { _type: 'task_result' } => e._type === 'task_result')
        .map((r) => r._task_unique_id),
    );
    expect(taskResultIds.has(childC1.unique_id)).toBe(false);
    expect(taskResultIds.has(rootR1.unique_id)).toBe(false);

    // ── Inject the user's answer as a TaskResult for the pending tool ────────
    const augmentedLog: ConversationLogEntry[] = [
      ...result1.logDiff,
      {
        _type: 'task_result',
        _task_unique_id: childC1.unique_id,
        result: 'User chose A',
        created_at: new Date().toISOString(),
      },
    ];

    // ── Turn 2: LLM is asked again with full context including the answer ────
    // Capture the streamFn's input to verify the LLM actually sees the resolved
    // tool result in its context.
    let streamFnContext: import('@mariozechner/pi-ai').Context | undefined;
    const mock2 = new MockStreamFn();
    mock2.configure([[{ type: 'text', text: 'You chose A. Done.' }]]);
    const innerStreamFn = mock2.asStreamFn();
    const wrappedStreamFn = ((model, context, options) => {
      streamFnContext = context;
      return innerStreamFn(model, context, options);
    }) as typeof innerStreamFn;

    const result2 = await runAgent(new ResumableAgent(), null, augmentedLog, ctx, wrappedStreamFn);

    // Resume completes successfully with the LLM's final reply
    expect(result2.state).toBe('success');
    if (result2.state !== 'success') return;
    expect(result2.content).toBe('You chose A. Done.');

    // Continuation root task R2 links to R1 via _previous_unique_id
    const rootR2 = result2.logDiff.find(
      (e): e is Task => e._type === 'task' && e._parent_unique_id === null,
    );
    expect(rootR2).toBeDefined();
    expect(rootR2!._previous_unique_id).toBe(rootR1.unique_id);

    // The LLM was actually shown the prior conversation including the injected
    // tool result — proving buildMessagesFromLog reconstructed it correctly.
    expect(streamFnContext).toBeDefined();
    const msgs = streamFnContext!.messages;
    const toolResultMsg = msgs.find((m) => m.role === 'toolResult');
    expect(toolResultMsg).toBeDefined();
    const trText = (toolResultMsg as { content: { text: string }[] }).content[0].text;
    expect(trText).toBe('User chose A');
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

describe('multi-turn follow-up: user sends another message after previous turn completes', () => {
  it('links root tasks AND surfaces full prior thread (user msg, tool call, tool result, reply) to the next turn\'s LLM', async () => {
    // ── Turn 1: user asks something. LLM calls simpleTool and replies. ───────
    const mock1 = new MockStreamFn();
    mock1.configure([
      [{ type: 'toolCall', id: 'tc-first', name: 'simpleTool', arguments: { value: 'first' } }],
      [{ type: 'text', text: 'First turn done' }],
    ]);

    const result1 = await runAgent(new TestAgent(), 'First message', [], ctx, mock1.asStreamFn());
    expect(result1.state).toBe('success');
    if (result1.state !== 'success') return;

    const firstRoot = result1.logDiff.find(
      (e): e is ConversationLogEntry & { _type: 'task' } =>
        e._type === 'task' && e._parent_unique_id === null,
    )!;
    expect(firstRoot._previous_unique_id).toBeNull();

    // ── Turn 2: user sends a follow-up. Capture what context the LLM sees. ───
    let streamFnContext: import('@mariozechner/pi-ai').Context | undefined;
    const mock2 = new MockStreamFn();
    mock2.configure([[{ type: 'text', text: 'Second turn done' }]]);
    const innerStreamFn = mock2.asStreamFn();
    const wrappedStreamFn = ((model, context, options) => {
      streamFnContext = context;
      return innerStreamFn(model, context, options);
    }) as typeof innerStreamFn;

    const result2 = await runAgent(
      new TestAgent(),
      'Second message',
      result1.logDiff,
      ctx,
      wrappedStreamFn,
    );

    expect(result2.state).toBe('success');
    if (result2.state !== 'success') return;

    // _previous_unique_id linking
    const secondRoot = result2.logDiff.find(
      (e): e is ConversationLogEntry & { _type: 'task' } =>
        e._type === 'task' && e._parent_unique_id === null,
    )!;
    expect(secondRoot._previous_unique_id).toBe(firstRoot.unique_id);

    // The crucial assertion: the second turn's LLM was actually shown the full
    // prior conversation reconstructed from the Task log.
    expect(streamFnContext).toBeDefined();
    const msgs = streamFnContext!.messages;

    // Expected prior-turn shape: user → assistant(toolCall) → toolResult → assistant(text)
    // PLUS the new user message ('Second message') prepended via prompts.
    // agentLoop merges context.messages + prompts before calling streamFn, so the
    // captured context.messages here includes both.
    const userMsgs = msgs.filter((m) => m.role === 'user');
    expect(userMsgs.length).toBe(2); // first message + second message

    // First user message survived from prior turn
    const firstUserText = (userMsgs[0] as { content: { text: string }[] | string }).content;
    const firstUserStr = typeof firstUserText === 'string'
      ? firstUserText
      : firstUserText[0].text;
    expect(firstUserStr).toBe('First message');

    // Second user message is the new prompt for this turn
    const secondUserText = (userMsgs[1] as { content: { text: string }[] | string }).content;
    const secondUserStr = typeof secondUserText === 'string'
      ? secondUserText
      : secondUserText[0].text;
    expect(secondUserStr).toBe('Second message');

    // Prior assistant tool call is in the thread
    const assistantToolUseMsg = msgs.find(
      (m) => m.role === 'assistant'
        && (m as { content: { type: string }[] }).content.some((c) => c.type === 'toolCall'),
    );
    expect(assistantToolUseMsg).toBeDefined();
    const toolCallBlock = (assistantToolUseMsg as { content: { type: string; name?: string; arguments?: Record<string, unknown> }[] })
      .content.find((c) => c.type === 'toolCall');
    expect(toolCallBlock!.name).toBe('simpleTool');
    expect(toolCallBlock!.arguments).toEqual({ value: 'first' });

    // Prior tool result is in the thread
    const toolResultMsg = msgs.find((m) => m.role === 'toolResult');
    expect(toolResultMsg).toBeDefined();
    const trText = (toolResultMsg as { content: { text: string }[] }).content[0].text;
    expect(trText).toBe('Tool result: first');

    // Prior assistant text reply is in the thread
    const finalAssistantTextMsg = msgs.find(
      (m) => m.role === 'assistant'
        && (m as { content: { type: string; text?: string }[] }).content.every((c) => c.type === 'text'),
    );
    expect(finalAssistantTextMsg).toBeDefined();
    const replyText = (finalAssistantTextMsg as { content: { type: string; text: string }[] }).content[0].text;
    expect(replyText).toBe('First turn done');
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
