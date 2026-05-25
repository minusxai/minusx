// Orchestrator behaviour suite — consolidated from the former one-test-per-file
// layout (cancel-in-flight, deep-resume, log-replay, max-steps, mixed-pending,
// multi-resume, multi-turn, parallel-mixed, parameter-validation,
// pending-event-shape, resume-after-replay, single-use, sub-agent[-tool-error],
// test-agent, three-level-nesting, tool-error, unknown-tool). Merged into one
// file so the heavy module graph + faux harness are imported once instead of 18×.
// Each test sets its own faux responses and builds a fresh Orchestrator, so they
// run independently.

import { Type } from 'typebox';
import type { TextContent, Tool, ToolCall, UserMessage } from '@/orchestrator/llm';
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from '@/orchestrator/llm/testing';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { MXAgent } from '@/orchestrator/types';
import type {
  AgentContext,
  ConversationLog,
  ConversationLogEntry,
  PendingToolEvent,
  StreamEvent,
} from '@/orchestrator/types';
import {
  EchoTool,
  PendingTool,
  ErrorTool,
  DeepAgent,
  NestedAgent,
  TestAgent,
  fauxRegistration,
} from '../test-agent';

describe('cancel in-flight', () => {
  it('cancel() aborts a running orchestrator; stream emits an error event with the agent\'s parent_id', async () => {
    fauxRegistration.setResponses([
      async () => {
        await new Promise((r) => setTimeout(r, 50));
        return fauxAssistantMessage('would have stopped.', { stopReason: 'stop' });
      },
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const orch = new Orchestrator([EchoTool, PendingTool, ErrorTool, DeepAgent, NestedAgent, TestAgent]);
    const agent = new TestAgent(orch, { userMessage: 'will be cancelled' }, ctx);

    const stream = orch.run(agent);

    setTimeout(() => orch.cancel(), 10);

    const events: StreamEvent[] = [];
    for await (const ev of stream) events.push(ev);
    const result = await stream.result();

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect((errorEvent as { parent_id: string }).parent_id).toBe(agent.id);
    expect(result).toBeNull();
  });
});

describe('deep resume (paused sub-agent bubbles up)', () => {
  it('TestAgent calls NestedAgent which pauses on PendingTool; resume bubbles to root', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('NestedAgent', { userMessage: 'go deeper' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage(
        [fauxToolCall('PendingTool', { prompt: 'frontend please' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('NestedAgent done.', { stopReason: 'stop' }),
      fauxAssistantMessage('Root done.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const registrables = [EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent];
    const orchA = new Orchestrator(registrables);
    const root = new TestAgent(orchA, { userMessage: 'root input' }, ctx);

    const phase1 = orchA.run(root);
    const events1 = [];
    for await (const ev of phase1) events1.push(ev);
    const result1 = await phase1.result();

    expect(result1).toBeNull();
    expect(events1.at(-1)).toMatchObject({ type: 'pending' });

    const pendingCall = orchA.log
      .flatMap((e) => ('role' in e && e.role === 'assistant' ? e.content.filter((c) => c.type === 'toolCall') : []))
      .find((tc): tc is ToolCall => tc.name === 'PendingTool');
    expect(pendingCall).toBeDefined();

    const orchB = new Orchestrator(registrables, orchA.log);
    const phase2 = orchB.resume([
      {
        role: 'toolResult',
        toolCallId: pendingCall!.id,
        toolName: 'PendingTool',
        content: [{ type: 'text', text: 'frontend completed it' }],
        isError: false,
        timestamp: Date.now(),
      },
    ]);
    for await (const _ of phase2) {/* drain */}
    const result2 = await phase2.result();

    expect(result2).not.toBeNull();
    expect(result2!.role).toBe('assistant');
    expect(result2!.stopReason).toBe('stop');
    expect((result2!.content[0] as TextContent).text).toContain('Root done.');

    const log: ConversationLogEntry[] = orchB.log;

    const nestedToolCallInRoot = log
      .flatMap((e) => ('role' in e && e.role === 'assistant' && e.parent_id === root.id ? e.content : []))
      .find((c) => c.type === 'toolCall' && c.name === 'NestedAgent');
    expect(nestedToolCallInRoot).toBeDefined();
    const nestedAgentId = (nestedToolCallInRoot as { id: string }).id;

    const nestedDispatch = log.find(
      (e) =>
        'role' in e &&
        e.role === 'assistant' &&
        e.parent_id === nestedAgentId &&
        e.content.some((c) => c.type === 'toolCall' && c.name === 'PendingTool'),
    );
    expect(nestedDispatch).toBeDefined();

    const wrappedNestedResult = log.find(
      (e) =>
        'role' in e &&
        e.role === 'toolResult' &&
        e.toolCallId === nestedAgentId &&
        e.toolName === 'NestedAgent',
    );
    expect(wrappedNestedResult).toBeDefined();
    expect(wrappedNestedResult!.parent_id).toBe(root.id);
    expect(((wrappedNestedResult as { content: TextContent[] }).content[0]).text).toContain('NestedAgent done.');

    const details = (wrappedNestedResult as { details?: { type?: string; assistantMessage?: { usage?: unknown; stopReason?: string } } }).details;
    expect(details?.type).toBe('mx_agent');
    expect(details?.assistantMessage?.usage).toBeDefined();
    expect(details?.assistantMessage?.stopReason).toBe('stop');

    const nestedAssistantStops = log.filter(
      (e) =>
        'role' in e &&
        e.role === 'assistant' &&
        e.parent_id === nestedAgentId &&
        e.stopReason === 'stop',
    );
    expect(nestedAssistantStops).toHaveLength(0);

    const rootStop = log.find(
      (e) =>
        'role' in e &&
        e.role === 'assistant' &&
        e.parent_id === root.id &&
        e.stopReason === 'stop',
    );
    expect(rootStop).toBeDefined();
  });
});

describe('log replay (stateless rehydration)', () => {
  it('serializes log, rehydrates into a fresh Orchestrator, second run sees prior turn', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage('First reply.', { stopReason: 'stop' }),
      fauxAssistantMessage('Second reply.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const registrables = [EchoTool, PendingTool, NestedAgent, TestAgent];

    const orchA = new Orchestrator(registrables);
    const a1 = new TestAgent(orchA, { userMessage: 'first' }, ctx);
    const streamA = orchA.run(a1);
    for await (const _ of streamA) {/* drain */}
    const result1 = await streamA.result();
    expect(result1).not.toBeNull();
    expect((result1!.content[0] as TextContent).text).toBe('First reply.');

    const serialized = JSON.stringify(orchA.log);
    const rehydratedLog: ConversationLog = JSON.parse(serialized);

    const orchB = new Orchestrator(registrables, rehydratedLog);
    const a2 = new TestAgent(orchB, { userMessage: 'second' }, ctx);
    const streamB = orchB.run(a2);
    for await (const _ of streamB) {/* drain */}
    const result2 = await streamB.result();
    expect(result2).not.toBeNull();
    expect((result2!.content[0] as TextContent).text).toBe('Second reply.');

    const firstUser = a2.threadHistory.find((m): m is UserMessage => m.role === 'user');
    expect(firstUser).toBeDefined();
    expect(firstUser!.content).toBe('first');

    const firstAssistant = a2.threadHistory.find(
      (m) => m.role === 'assistant' && m.stopReason === 'stop',
    );
    expect(firstAssistant).toBeDefined();
    expect((firstAssistant!.content[0] as TextContent).text).toBe('First reply.');
  });
});

describe('MXAgent.run() step cap', () => {
  // The orchestrator-owned agent loop must enforce a step cap, hard-stop at
  // `maxSteps` with a "Maximum iterations (N) reached." reply, and soft-withhold
  // tools once the thread reaches `maxSteps − 5` so the model must give a final
  // answer. The cap VALUE comes from the concrete agent (static maxSteps); the
  // loop mechanism lives in the base agent.
  const faux = registerFauxProvider({
    api: 'faux-cap-api',
    provider: 'faux-cap',
    models: [{ id: 'cap-model' }],
  });
  const CAP_MODEL = faux.getModel();

  const CappedParams = Type.Object({ userMessage: Type.String() });

  // A minimal agent that loops via EchoTool (which resolves locally and continues
  // the loop). maxSteps=6 → soft cap at toolThread.length >= 1, hard cap at 6.
  class CappedAgent extends MXAgent<typeof CappedParams> {
    static readonly schema: Tool<typeof CappedParams> = {
      name: 'CappedAgent',
      description: 'Loops via EchoTool; exercises the maxSteps cap.',
      parameters: CappedParams,
    };
    static readonly tools = [EchoTool.schema];
    static readonly model = CAP_MODEL;
    static readonly maxSteps = 6;
    protected getSystemPrompt(): string {
      return 'capped';
    }
  }

  const ctx: AgentContext = { userId: 'u', mode: 'org' };

  async function runCapped() {
    const orch = new Orchestrator([EchoTool, CappedAgent]);
    const agent = new CappedAgent(orch, { userMessage: 'go' }, ctx);
    const stream = orch.run(agent);
    for await (const _ of stream) {
      /* drain events */
    }
    return { agent, result: await stream.result() };
  }

  it('hard-stops with "Maximum iterations (N) reached." once the thread hits maxSteps', async () => {
    // Model never voluntarily stops — always calls a tool.
    faux.setResponses(
      Array.from({ length: 20 }, () =>
        fauxAssistantMessage([fauxToolCall('EchoTool', { text: 'loop' })], {
          stopReason: 'toolUse',
        }),
      ),
    );

    const { result } = await runCapped();

    expect(result).not.toBeNull();
    expect((result!.content[0] as TextContent).text).toBe('Maximum iterations (6) reached.');
    expect(result!.stopReason).toBe('stop');
  });

  it('soft-withholds tools once the thread reaches maxSteps − 5', async () => {
    const toolsPerCall: number[] = [];
    faux.setResponses(
      Array.from({ length: 20 }, () => (context: { tools?: unknown[] }) => {
        toolsPerCall.push(context.tools?.length ?? 0);
        return fauxAssistantMessage([fauxToolCall('EchoTool', { text: 'loop' })], {
          stopReason: 'toolUse',
        });
      }),
    );

    await runCapped();

    // First call: thread empty (0 < 1) → tool offered. Subsequent calls: thread
    // has grown past maxSteps − 5 (=1) → no tools, forcing the model to answer.
    expect(toolsPerCall[0]).toBe(1);
    expect(toolsPerCall[1]).toBe(0);
  });

  it('returns the model reply unchanged when it stops before the cap', async () => {
    faux.setResponses([fauxAssistantMessage('done', { stopReason: 'stop' })]);
    const { result } = await runCapped();
    expect((result!.content[0] as TextContent).text).toBe('done');
  });
});

describe('mixed-pending resume (partial completion across resume calls)', () => {
  it('partial resume does not re-run the agent; full resume does', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall('PendingTool', { prompt: 'first' }),
          fauxToolCall('PendingTool', { prompt: 'second' }),
          fauxToolCall('PendingTool', { prompt: 'third' }),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('All three resolved.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const registrables = [EchoTool, PendingTool, ErrorTool, DeepAgent, NestedAgent, TestAgent];

    const orchA = new Orchestrator(registrables);
    const agent = new TestAgent(orchA, { userMessage: 'three pending' }, ctx);
    const phaseA = orchA.run(agent);
    for await (const _ of phaseA) {/* drain to pending */}
    expect(await phaseA.result()).toBeNull();

    const pendingCalls = orchA.log
      .flatMap((e) => ('role' in e && e.role === 'assistant' ? e.content.filter((c) => c.type === 'toolCall') : []))
      .filter((tc): tc is ToolCall => tc.name === 'PendingTool');
    expect(pendingCalls).toHaveLength(3);

    const assistantTurnsBeforeResume = orchA.log.filter(
      (e) => 'role' in e && e.role === 'assistant' && e.parent_id === agent.id,
    ).length;

    const orchB = new Orchestrator(registrables, orchA.log);
    const phaseB = orchB.resume([
      {
        role: 'toolResult',
        toolCallId: pendingCalls[0].id,
        toolName: 'PendingTool',
        content: [{ type: 'text', text: 'one' }],
        isError: false,
        timestamp: Date.now(),
      },
      {
        role: 'toolResult',
        toolCallId: pendingCalls[1].id,
        toolName: 'PendingTool',
        content: [{ type: 'text', text: 'two' }],
        isError: false,
        timestamp: Date.now(),
      },
    ]);
    for await (const _ of phaseB) {/* drain */}
    expect(await phaseB.result()).toBeNull();

    const assistantTurnsAfterPartial = orchB.log.filter(
      (e) => 'role' in e && e.role === 'assistant' && e.parent_id === agent.id,
    ).length;
    expect(assistantTurnsAfterPartial).toBe(assistantTurnsBeforeResume);

    const resolvedAfterPartial = orchB.log.filter(
      (e) => 'role' in e && e.role === 'toolResult' && e.toolName === 'PendingTool',
    ).length;
    expect(resolvedAfterPartial).toBe(2);

    const orchC = new Orchestrator(registrables, orchB.log);
    const phaseC = orchC.resume([
      {
        role: 'toolResult',
        toolCallId: pendingCalls[2].id,
        toolName: 'PendingTool',
        content: [{ type: 'text', text: 'three' }],
        isError: false,
        timestamp: Date.now(),
      },
    ]);
    for await (const _ of phaseC) {/* drain */}
    const final = await phaseC.result();

    expect(final).not.toBeNull();
    expect(final!.role).toBe('assistant');
    expect(final!.stopReason).toBe('stop');
    expect((final!.content[0] as TextContent).text).toContain('All three resolved.');

    const resolvedFinal = orchC.log.filter(
      (e) => 'role' in e && e.role === 'toolResult' && e.toolName === 'PendingTool',
    ).length;
    expect(resolvedFinal).toBe(3);
  });
});

describe('multi-resume (pause → resume → pause again → resume again)', () => {
  it('handles two consecutive pause/resume cycles, each on a fresh orchestrator', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('PendingTool', { prompt: 'first pause' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage(
        [fauxToolCall('PendingTool', { prompt: 'second pause' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('All done at last.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const registrables = [EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent];

    const orchA = new Orchestrator(registrables);
    const agent = new TestAgent(orchA, { userMessage: 'multi-pause' }, ctx);
    const phaseA = orchA.run(agent);
    for await (const _ of phaseA) {/* drain */}
    expect(await phaseA.result()).toBeNull();

    const firstPendingId = orchA.log
      .flatMap((e) => ('role' in e && e.role === 'assistant' ? e.content.filter((c) => c.type === 'toolCall') : []))
      .find((tc): tc is ToolCall => tc.name === 'PendingTool')!.id;

    const orchB = new Orchestrator(registrables, orchA.log);
    const phaseB = orchB.resume([
      {
        role: 'toolResult',
        toolCallId: firstPendingId,
        toolName: 'PendingTool',
        content: [{ type: 'text', text: 'first done' }],
        isError: false,
        timestamp: Date.now(),
      },
    ]);
    for await (const _ of phaseB) {/* drain */}
    expect(await phaseB.result()).toBeNull();

    const allPending = orchB.log
      .flatMap((e) => ('role' in e && e.role === 'assistant' ? e.content.filter((c) => c.type === 'toolCall') : []))
      .filter((tc): tc is ToolCall => tc.name === 'PendingTool');
    expect(allPending).toHaveLength(2);
    const secondPendingId = allPending.find((tc) => tc.id !== firstPendingId)!.id;

    const orchC = new Orchestrator(registrables, orchB.log);
    const phaseC = orchC.resume([
      {
        role: 'toolResult',
        toolCallId: secondPendingId,
        toolName: 'PendingTool',
        content: [{ type: 'text', text: 'second done' }],
        isError: false,
        timestamp: Date.now(),
      },
    ]);
    for await (const _ of phaseC) {/* drain */}
    const final = await phaseC.result();

    expect(final).not.toBeNull();
    expect(final!.role).toBe('assistant');
    expect(final!.stopReason).toBe('stop');
    expect((final!.content[0] as TextContent).text).toContain('All done at last.');

    const resolvedToolCalls = orchC.log.filter(
      (e) => 'role' in e && e.role === 'toolResult' && e.toolName === 'PendingTool',
    );
    expect(resolvedToolCalls).toHaveLength(2);
  });
});

describe('multi-turn root conversation', () => {
  it('second turn on a fresh orchestrator inherits the first turn via threadHistory', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage('Reply to first.', { stopReason: 'stop' }),
      fauxAssistantMessage('Reply to second.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const registrables = [EchoTool, PendingTool, NestedAgent, TestAgent];

    const orchA = new Orchestrator(registrables);
    const a1 = new TestAgent(orchA, { userMessage: 'first' }, ctx);
    const stream1 = orchA.run(a1);
    for await (const _ of stream1) {/* drain events */}
    const result1 = await stream1.result();
    expect(result1).not.toBeNull();
    expect((result1!.content[0] as TextContent).text).toBe('Reply to first.');

    const orchB = new Orchestrator(registrables, orchA.log);
    const a2 = new TestAgent(orchB, { userMessage: 'second' }, ctx);
    const stream2 = orchB.run(a2);
    for await (const _ of stream2) {/* drain events */}
    const result2 = await stream2.result();
    expect(result2).not.toBeNull();
    expect((result2!.content[0] as TextContent).text).toBe('Reply to second.');

    const history = a2.threadHistory;

    const firstUser = history.find((m): m is UserMessage => m.role === 'user');
    expect(firstUser).toBeDefined();
    expect(firstUser!.content).toBe('first');

    const firstAssistant = history.find((m) => m.role === 'assistant' && m.stopReason === 'stop');
    expect(firstAssistant).toBeDefined();
    expect((firstAssistant!.content[0] as TextContent).text).toBe('Reply to first.');
  });
});

describe('parallel mixed-state dispatch', () => {
  it('runs two parallel tool_calls; one succeeds, one pauses; resume completes', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall('EchoTool', { text: 'parallel hello' }),
          fauxToolCall('PendingTool', { prompt: 'frontend please' }),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Both done.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const registrables = [EchoTool, PendingTool, NestedAgent, TestAgent];
    const orchA = new Orchestrator(registrables);
    const agent = new TestAgent(orchA, { userMessage: 'parallel test' }, ctx);

    const phase1 = orchA.run(agent);
    const events1: StreamEvent[] = [];
    for await (const ev of phase1) events1.push(ev);
    const result1 = await phase1.result();

    expect(result1).toBeNull();
    const pendingEvent = events1.find((e) => e.type === 'pending');
    expect(pendingEvent).toBeDefined();

    const echoResult = orchA.log.find(
      (e) => 'role' in e && e.role === 'toolResult' && e.toolName === 'EchoTool',
    );
    const pendingResult = orchA.log.find(
      (e) => 'role' in e && e.role === 'toolResult' && e.toolName === 'PendingTool',
    );
    expect(echoResult).toBeDefined();
    expect(pendingResult).toBeUndefined();

    const pendingCall = orchA.log
      .flatMap((e) => ('role' in e && e.role === 'assistant' ? e.content.filter((c) => c.type === 'toolCall') : []))
      .find((tc): tc is ToolCall => tc.name === 'PendingTool');
    expect(pendingCall).toBeDefined();

    const orchB = new Orchestrator(registrables, orchA.log);
    const phase2 = orchB.resume([
      {
        role: 'toolResult',
        toolCallId: pendingCall!.id,
        toolName: 'PendingTool',
        content: [{ type: 'text', text: 'frontend done' }],
        isError: false,
        timestamp: Date.now(),
      },
    ]);
    const events2: StreamEvent[] = [];
    for await (const ev of phase2) events2.push(ev);
    const result2 = await phase2.result();

    expect(result2).not.toBeNull();
    expect(result2!.role).toBe('assistant');
    expect(result2!.stopReason).toBe('stop');
    expect((result2!.content[0] as TextContent).text).toContain('Both done.');
  });
});

describe('parameter validation', () => {
  const ctx: AgentContext = { userId: 'u', mode: 'org' };
  const registrables = [EchoTool, PendingTool, TestAgent];

  function getToolResults(orch: Orchestrator) {
    return orch.log.filter(
      (e) => 'role' in e && e.role === 'toolResult',
    ) as { toolName: string; isError: boolean; content: TextContent[] }[];
  }

  it('rejects wrong-type parameters with a recoverable error', async () => {
    fauxRegistration.setResponses([
      // EchoTool expects { text: string }, LLM passes a number
      fauxAssistantMessage([fauxToolCall('EchoTool', { text: 123 })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('giving up', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(registrables);
    const agent = new TestAgent(orch, { userMessage: 'go' }, ctx);
    const stream = orch.run(agent);
    for await (const _ of stream) {/* drain */}
    const result = await stream.result();

    expect(result?.stopReason).toBe('stop');
    const trms = getToolResults(orch);
    expect(trms).toHaveLength(1);
    expect(trms[0].toolName).toBe('EchoTool');
    expect(trms[0].isError).toBe(true);
    expect(trms[0].content[0].text).toMatch(/Invalid parameters for 'EchoTool'/);
    expect(trms[0].content[0].text.toLowerCase()).toContain('string');
  });

  it('rejects missing required parameters with a recoverable error', async () => {
    fauxRegistration.setResponses([
      // EchoTool requires `text`, LLM omits it
      fauxAssistantMessage([fauxToolCall('EchoTool', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('giving up', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(registrables);
    const agent = new TestAgent(orch, { userMessage: 'go' }, ctx);
    const stream = orch.run(agent);
    for await (const _ of stream) {/* drain */}
    const result = await stream.result();

    expect(result?.stopReason).toBe('stop');
    const trms = getToolResults(orch);
    expect(trms).toHaveLength(1);
    expect(trms[0].isError).toBe(true);
    expect(trms[0].content[0].text.toLowerCase()).toContain('text');
  });

  it('passes valid input through unchanged (regression check)', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage([fauxToolCall('EchoTool', { text: 'hello' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('done', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(registrables);
    const agent = new TestAgent(orch, { userMessage: 'go' }, ctx);
    const stream = orch.run(agent);
    for await (const _ of stream) {/* drain */}
    const result = await stream.result();

    expect(result?.stopReason).toBe('stop');
    const trms = getToolResults(orch);
    expect(trms).toHaveLength(1);
    expect(trms[0].isError).toBe(false);
    expect(trms[0].content[0].text).toBe('echo: hello');
  });

  it('lets the agent recover with a valid call after a validation error', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage([fauxToolCall('EchoTool', { text: 42 })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('EchoTool', { text: 'second try' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('done', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(registrables);
    const agent = new TestAgent(orch, { userMessage: 'go' }, ctx);
    const stream = orch.run(agent);
    for await (const _ of stream) {/* drain */}
    const result = await stream.result();

    expect(result?.stopReason).toBe('stop');
    const trms = getToolResults(orch);
    expect(trms.map((t) => t.isError)).toEqual([true, false]);
    expect(trms[1].content[0].text).toBe('echo: second try');
  });
});

describe('rich pending event + getPendingToolCalls', () => {
  it('emits a per-tool pending event with full info; getPendingToolCalls mirrors it from the log', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall('PendingTool', { prompt: 'first' }),
          fauxToolCall('PendingTool', { prompt: 'second' }),
        ],
        { stopReason: 'toolUse' },
      ),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org', connectionId: 'c1' };
    const registrables = [EchoTool, PendingTool, ErrorTool, DeepAgent, NestedAgent, TestAgent];
    const orch = new Orchestrator(registrables);
    const agent = new TestAgent(orch, { userMessage: 'two pending' }, ctx);

    const stream = orch.run(agent);
    const events: StreamEvent[] = [];
    for await (const ev of stream) events.push(ev);
    await stream.result();

    const pendingEvents = events.filter((e): e is PendingToolEvent => e.type === 'pending');
    expect(pendingEvents).toHaveLength(2);

    for (const pe of pendingEvents) {
      expect(typeof pe.id).toBe('string');
      expect(pe.name).toBe('PendingTool');
      expect(typeof pe.parameters).toBe('object');
      expect(pe.parameters).toHaveProperty('prompt');
      expect(pe.context).toEqual(ctx);
      expect(pe.parent_id).toBe(agent.id);
    }

    const prompts = pendingEvents.map((pe) => (pe.parameters as { prompt: string }).prompt).sort();
    expect(prompts).toEqual(['first', 'second']);

    const pending = orch.getPendingToolCalls();
    expect(pending).toHaveLength(2);
    for (const p of pending) {
      expect(p.name).toBe('PendingTool');
      expect(p.context).toEqual(ctx);
      expect(p.parent_id).toBe(agent.id);
      expect(p.parameters).toHaveProperty('prompt');
    }

    const eventIds = pendingEvents.map((pe) => pe.id).sort();
    const logIds = pending.map((p) => p.id).sort();
    expect(eventIds).toEqual(logIds);
  });

  it('after a fully-resolved run, getPendingToolCalls returns []', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage('Done.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const registrables = [EchoTool, PendingTool, ErrorTool, DeepAgent, NestedAgent, TestAgent];
    const orch = new Orchestrator(registrables);
    const agent = new TestAgent(orch, { userMessage: 'hi' }, ctx);

    const stream = orch.run(agent);
    for await (const _ of stream) {/* drain */}
    await stream.result();

    expect(orch.getPendingToolCalls()).toEqual([]);
  });
});

describe('resume after JSON round-trip (rehydrate mid-pause)', () => {
  it('serializes a paused log, rehydrates into a fresh Orchestrator, resumes to completion', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('PendingTool', { prompt: 'mid-flight' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Resumed cleanly.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const registrables = [EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent];

    const orchA = new Orchestrator(registrables);
    const agentA = new TestAgent(orchA, { userMessage: 'first run' }, ctx);
    const streamA = orchA.run(agentA);
    for await (const _ of streamA) {/* drain to pending */}
    expect(await streamA.result()).toBeNull();

    const pendingId = orchA.log
      .flatMap((e) => ('role' in e && e.role === 'assistant' ? e.content.filter((c) => c.type === 'toolCall') : []))
      .find((tc): tc is ToolCall => tc.name === 'PendingTool')!.id;

    const serialized = JSON.stringify(orchA.log);
    const rehydratedLog: ConversationLog = JSON.parse(serialized);

    const orchB = new Orchestrator(registrables, rehydratedLog);
    const stream = orchB.resume([
      {
        role: 'toolResult',
        toolCallId: pendingId,
        toolName: 'PendingTool',
        content: [{ type: 'text', text: 'host completed it' }],
        isError: false,
        timestamp: Date.now(),
      },
    ]);
    for await (const _ of stream) {/* drain */}
    const result = await stream.result();

    expect(result).not.toBeNull();
    expect(result!.role).toBe('assistant');
    expect(result!.stopReason).toBe('stop');
    expect((result!.content[0] as TextContent).text).toContain('Resumed cleanly.');

    const completedPending = orchB.log.find(
      (e): e is typeof e & { role: 'toolResult'; toolCallId: string; isError: boolean } =>
        'role' in e && e.role === 'toolResult' && e.toolCallId === pendingId,
    );
    expect(completedPending).toBeDefined();
    expect(completedPending!.isError).toBe(false);
  });
});

describe('Orchestrator single-use guard', () => {
  const ctx: AgentContext = { userId: 'u', mode: 'org' };
  const registrables = [EchoTool, PendingTool, ErrorTool, DeepAgent, NestedAgent, TestAgent];

  it('run() then run() throws', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage('done.', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(registrables);
    const agent1 = new TestAgent(orch, { userMessage: 'one' }, ctx);
    const stream = orch.run(agent1);
    for await (const _ of stream) {/* drain */}
    await stream.result();

    const agent2 = new TestAgent(orch, { userMessage: 'two' }, ctx);
    expect(() => orch.run(agent2)).toThrow(/single-use/);
  });

  it('run() then resume() throws', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage('done.', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(registrables);
    const agent = new TestAgent(orch, { userMessage: 'one' }, ctx);
    const stream = orch.run(agent);
    for await (const _ of stream) {/* drain */}
    await stream.result();

    expect(() =>
      orch.resume([
        {
          role: 'toolResult',
          toolCallId: 'whatever',
          toolName: 'whatever',
          content: [{ type: 'text', text: '' }],
          isError: false,
          timestamp: Date.now(),
        },
      ]),
    ).toThrow(/single-use/);
  });

  it('resume() then resume() throws', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage([fauxToolCall('PendingTool', { prompt: 'pause' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('done.', { stopReason: 'stop' }),
    ]);

    const orchA = new Orchestrator(registrables);
    const agent = new TestAgent(orchA, { userMessage: 'one' }, ctx);
    const sa = orchA.run(agent);
    for await (const _ of sa) {/* drain */}

    const pendingId = orchA.log
      .flatMap((e) => ('role' in e && e.role === 'assistant' ? e.content.filter((c) => c.type === 'toolCall') : []))
      .find((tc) => tc.name === 'PendingTool')!.id;

    const orchB = new Orchestrator(registrables, orchA.log);
    const sb = orchB.resume([
      {
        role: 'toolResult',
        toolCallId: pendingId,
        toolName: 'PendingTool',
        content: [{ type: 'text', text: 'k' }],
        isError: false,
        timestamp: Date.now(),
      },
    ]);
    for await (const _ of sb) {/* drain */}
    await sb.result();

    expect(() =>
      orchB.resume([
        {
          role: 'toolResult',
          toolCallId: pendingId,
          toolName: 'PendingTool',
          content: [{ type: 'text', text: 'k' }],
          isError: false,
          timestamp: Date.now(),
        },
      ]),
    ).toThrow(/single-use/);
  });
});

describe('sub-agent tool error', () => {
  it('tool error inside a sub-agent appends an isError toolResult; sub-agent stops and bubbles up cleanly', async () => {
    fauxRegistration.setResponses([
      // Root: dispatch NestedAgent.
      fauxAssistantMessage(
        [fauxToolCall('NestedAgent', { userMessage: 'go deeper' })],
        { stopReason: 'toolUse' },
      ),
      // Inside NestedAgent: call ErrorTool.
      fauxAssistantMessage(
        [fauxToolCall('ErrorTool', { reason: 'kaboom' })],
        { stopReason: 'toolUse' },
      ),
      // NestedAgent sees the error; stop.
      fauxAssistantMessage('Sub-agent saw the error and stopped.', { stopReason: 'stop' }),
      // Root sees NestedAgent's reply; stop.
      fauxAssistantMessage('Root acknowledges the sub-agent error.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const orch = new Orchestrator([EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent]);
    const root = new TestAgent(orch, { userMessage: 'trigger nested error' }, ctx);

    const stream = orch.run(root);
    const events: StreamEvent[] = [];
    for await (const ev of stream) events.push(ev);
    const result = await stream.result();

    // Stream completes with the root agent's stop reply — sub-agent's tool
    // error didn't kill the turn.
    expect(result).not.toBeNull();
    expect(result?.stopReason).toBe('stop');

    // No pending events from the sub-agent's tool error — server tools
    // never get reported as pending.
    const pendingEvent = events.find((e) => e.type === 'pending');
    expect(pendingEvent).toBeUndefined();

    // ErrorTool's failure IS recorded in the log as an isError toolResult.
    const errToolResultInLog = orch.log.find(
      (e) => 'role' in e && e.role === 'toolResult' && e.toolName === 'ErrorTool',
    );
    expect(errToolResultInLog).toBeDefined();
    expect((errToolResultInLog as { isError?: boolean }).isError).toBe(true);

    // getPendingToolCalls returns nothing — agent saw the error and stopped.
    expect(orch.getPendingToolCalls()).toEqual([]);
  });
});

describe('sub-agent dispatch (agent-as-tool)', () => {
  it('TestAgent dispatches NestedAgent; nested stop becomes a ToolResultMessage in root\'s thread', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('NestedAgent', { userMessage: 'nested input' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Nested done.', { stopReason: 'stop' }),
      fauxAssistantMessage('All done at root.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const orch = new Orchestrator([EchoTool, PendingTool, NestedAgent, TestAgent]);
    const root = new TestAgent(orch, { userMessage: 'root input' }, ctx);

    const stream = orch.run(root);
    for await (const _ of stream) {/* drain */}
    const result = await stream.result();

    expect(result).not.toBeNull();
    expect(result!.role).toBe('assistant');
    expect(result!.stopReason).toBe('stop');
    expect((result!.content[0] as TextContent).text).toContain('All done at root.');

    const log: ConversationLogEntry[] = orch.log;

    const nestedToolCall = log
      .flatMap((e) => ('role' in e && e.role === 'assistant' ? e.content : []))
      .find((c) => c.type === 'toolCall' && c.name === 'NestedAgent');
    expect(nestedToolCall).toBeDefined();
    const nestedAgentId = (nestedToolCall as { id: string }).id;

    const nestedAssistantEntries = log.filter(
      (e) => 'role' in e && e.role === 'assistant' && e.parent_id === nestedAgentId,
    );
    expect(nestedAssistantEntries).toHaveLength(0);

    const wrappedResult = log.find(
      (e) =>
        'role' in e &&
        e.role === 'toolResult' &&
        e.toolCallId === nestedAgentId &&
        e.toolName === 'NestedAgent',
    );
    expect(wrappedResult).toBeDefined();
    expect(wrappedResult!.parent_id).toBe(root.id);
    expect(((wrappedResult as { content: TextContent[] }).content[0]).text).toContain('Nested done.');

    const details = (wrappedResult as { details?: { type?: string; assistantMessage?: { usage?: unknown; stopReason?: string } } }).details;
    expect(details?.type).toBe('mx_agent');
    expect(details?.assistantMessage?.usage).toBeDefined();
    expect(details?.assistantMessage?.stopReason).toBe('stop');

    const rootStop = log.find(
      (e) =>
        'role' in e &&
        e.role === 'assistant' &&
        e.parent_id === root.id &&
        e.stopReason === 'stop',
    );
    expect(rootStop).toBeDefined();
  });
});

describe('orchestrator e2e', () => {
  it('runs, pauses on pending tool call, resumes, returns final result', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage([fauxToolCall('PendingTool', { prompt: 'frontend please' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('All done!', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const registrables = [EchoTool, PendingTool, TestAgent];
    const orchA = new Orchestrator(registrables);
    const agent = new TestAgent(orchA, { userMessage: 'hi' }, ctx);

    const phase1 = orchA.run(agent);
    const events1: StreamEvent[] = [];
    for await (const ev of phase1) events1.push(ev);
    const result1 = await phase1.result();

    expect(events1.length).toBeGreaterThan(0);
    expect(events1.at(-1)).toMatchObject({ type: 'pending' });
    expect(result1).toBeNull();

    const pendingCall = orchA.log
      .flatMap((e) => ('role' in e && e.role === 'assistant' ? e.content.filter((c) => c.type === 'toolCall') : []))
      .find((tc): tc is ToolCall => tc.name === 'PendingTool');
    expect(pendingCall).toBeDefined();

    const orchB = new Orchestrator(registrables, orchA.log);
    const phase2 = orchB.resume([
      {
        role: 'toolResult',
        toolCallId: pendingCall!.id,
        toolName: 'PendingTool',
        content: [{ type: 'text', text: 'frontend completed it' }],
        isError: false,
        timestamp: Date.now(),
      },
    ]);
    const events2: StreamEvent[] = [];
    for await (const ev of phase2) events2.push(ev);
    const result2 = await phase2.result();

    expect(events2.some((e) => e.type === 'done')).toBe(true);
    expect(result2).not.toBeNull();
    expect(result2!.role).toBe('assistant');
    expect(result2!.stopReason).toBe('stop');
    expect((result2!.content[0] as TextContent).text).toContain('All done!');
  });
});

describe('3-level deep nesting (TestAgent → NestedAgent → DeepAgent → stop)', () => {
  it('bubbles wrapped ToolResultMessages up two layers, only the root\'s stop AssistantMessage lives in the log', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('NestedAgent', { userMessage: 'middle' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage(
        [fauxToolCall('DeepAgent', { userMessage: 'deep' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Deep done.', { stopReason: 'stop' }),
      fauxAssistantMessage('Nested done.', { stopReason: 'stop' }),
      fauxAssistantMessage('Root done.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const orch = new Orchestrator([EchoTool, PendingTool, ErrorTool, DeepAgent, NestedAgent, TestAgent]);
    const root = new TestAgent(orch, { userMessage: 'root' }, ctx);

    const stream = orch.run(root);
    for await (const _ of stream) {/* drain */}
    const result = await stream.result();

    expect(result).not.toBeNull();
    expect(result!.role).toBe('assistant');
    expect(result!.stopReason).toBe('stop');
    expect((result!.content[0] as TextContent).text).toContain('Root done.');

    const log: ConversationLogEntry[] = orch.log;

    const nestedToolCall = log
      .flatMap((e) => ('role' in e && e.role === 'assistant' && e.parent_id === root.id ? e.content : []))
      .find((c): c is ToolCall => c.type === 'toolCall' && c.name === 'NestedAgent');
    expect(nestedToolCall).toBeDefined();
    const nestedAgentId = nestedToolCall!.id;

    const deepToolCall = log
      .flatMap((e) => ('role' in e && e.role === 'assistant' && e.parent_id === nestedAgentId ? e.content : []))
      .find((c): c is ToolCall => c.type === 'toolCall' && c.name === 'DeepAgent');
    expect(deepToolCall).toBeDefined();
    const deepAgentId = deepToolCall!.id;

    const deepStopAssistants = log.filter(
      (e) => 'role' in e && e.role === 'assistant' && e.parent_id === deepAgentId && e.stopReason === 'stop',
    );
    expect(deepStopAssistants).toHaveLength(0);

    const nestedStopAssistants = log.filter(
      (e) => 'role' in e && e.role === 'assistant' && e.parent_id === nestedAgentId && e.stopReason === 'stop',
    );
    expect(nestedStopAssistants).toHaveLength(0);

    const deepWrap = log.find(
      (e): e is typeof e & { role: 'toolResult'; toolCallId: string; content: TextContent[] } =>
        'role' in e && e.role === 'toolResult' && e.toolCallId === deepAgentId,
    );
    expect(deepWrap).toBeDefined();
    expect(deepWrap!.parent_id).toBe(nestedAgentId);
    expect(deepWrap!.content[0].text).toContain('Deep done.');

    const nestedWrap = log.find(
      (e): e is typeof e & { role: 'toolResult'; toolCallId: string; content: TextContent[] } =>
        'role' in e && e.role === 'toolResult' && e.toolCallId === nestedAgentId,
    );
    expect(nestedWrap).toBeDefined();
    expect(nestedWrap!.parent_id).toBe(root.id);
    expect(nestedWrap!.content[0].text).toContain('Nested done.');

    const rootStop = log.find(
      (e) =>
        'role' in e &&
        e.role === 'assistant' &&
        e.parent_id === root.id &&
        e.stopReason === 'stop',
    );
    expect(rootStop).toBeDefined();
  });
});

describe('tool error propagation (non-UserInputException)', () => {
  it('appends an isError toolResult to the log so the agent can recover; tool is NOT reported as pending', async () => {
    // Turn 1: agent calls ErrorTool which throws.
    // Turn 2: agent stops cleanly. Without this stop, the orchestrator would
    // loop forever calling LLM with an error result. The faux response
    // simulates the model deciding "ok, just stop" after seeing the error.
    fauxRegistration.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('ErrorTool', { reason: 'boom' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Tool failed; stopping.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const orch = new Orchestrator([EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent]);
    const agent = new TestAgent(orch, { userMessage: 'trigger error' }, ctx);

    const stream = orch.run(agent);
    const events: StreamEvent[] = [];
    for await (const ev of stream) events.push(ev);
    const result = await stream.result();

    // Stream completes cleanly with the agent's final stop message.
    expect(result).not.toBeNull();
    expect(result?.stopReason).toBe('stop');

    // The error toolResult IS present in the log — agent saw it and decided
    // to stop. This is what prevents `getPendingToolCalls()` from
    // misreporting the failed tool as pending (which would cause the
    // frontend to try to bridge a server-side tool).
    const errToolResult = orch.log.find(
      (e) => 'role' in e && e.role === 'toolResult' && e.toolName === 'ErrorTool',
    );
    expect(errToolResult).toBeDefined();
    expect((errToolResult as { isError?: boolean }).isError).toBe(true);

    // No pending events — server tool failures don't pause the orchestrator.
    const pendingEvent = events.find((e) => e.type === 'pending');
    expect(pendingEvent).toBeUndefined();

    // And critically: getPendingToolCalls() doesn't include the failed tool.
    const pending = orch.getPendingToolCalls();
    expect(pending.find((p) => p.name === 'ErrorTool')).toBeUndefined();
  });
});

describe('unknown tool handling', () => {
  const ctx: AgentContext = { userId: 'u', mode: 'org' };

  it('returns an error ToolResultMessage for a hallucinated tool, then reaches stop', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage([fauxToolCall('NotARealTool', { x: 1 })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('I will stop now.', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator([EchoTool, PendingTool, TestAgent]);
    const agent = new TestAgent(orch, { userMessage: 'go' }, ctx);
    const stream = orch.run(agent);
    for await (const _ of stream) {/* drain */}
    const result = await stream.result();

    expect(result?.stopReason).toBe('stop');
    expect((result!.content[0] as TextContent).text).toContain('I will stop now.');

    const toolResult = orch.log.find(
      (e) => 'role' in e && e.role === 'toolResult' && e.toolName === 'NotARealTool',
    ) as { isError: boolean; content: TextContent[] } | undefined;
    expect(toolResult).toBeDefined();
    expect(toolResult!.isError).toBe(true);
    expect(toolResult!.content[0].text).toContain("Unknown tool 'NotARealTool'");
    expect(toolResult!.content[0].text).toContain('EchoTool');
  });

  it('lets the agent recover by calling a real tool after the hallucinated one', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage([fauxToolCall('NotARealTool', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('EchoTool', { text: 'hello' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('done', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator([EchoTool, PendingTool, TestAgent]);
    const agent = new TestAgent(orch, { userMessage: 'go' }, ctx);
    const stream = orch.run(agent);
    for await (const _ of stream) {/* drain */}
    const result = await stream.result();

    expect(result?.stopReason).toBe('stop');

    const toolResults = orch.log.filter(
      (e) => 'role' in e && e.role === 'toolResult',
    ) as { toolName: string; isError: boolean; content: TextContent[] }[];
    expect(toolResults.map((t) => t.toolName)).toEqual(['NotARealTool', 'EchoTool']);
    expect(toolResults[0].isError).toBe(true);
    expect(toolResults[1].isError).toBe(false);
    expect(toolResults[1].content[0].text).toBe('echo: hello');
  });

  it('appends the unknown-tool error at the sub-agent parent_id, not the root', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('NestedAgent', { userMessage: 'sub-go' })],
        { stopReason: 'toolUse' },
      ),
      // NestedAgent: hallucinate, then stop
      fauxAssistantMessage([fauxToolCall('NotInSubAgent', {})], { stopReason: 'toolUse' }),
      fauxAssistantMessage('sub stopped', { stopReason: 'stop' }),
      // Root agent stop
      fauxAssistantMessage('root stopped', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator([EchoTool, PendingTool, NestedAgent, TestAgent]);
    const root = new TestAgent(orch, { userMessage: 'go' }, ctx);
    const stream = orch.run(root);
    for await (const _ of stream) {/* drain */}
    const result = await stream.result();

    expect(result?.stopReason).toBe('stop');

    const errorTrm = orch.log.find(
      (e) => 'role' in e && e.role === 'toolResult' && e.toolName === 'NotInSubAgent',
    ) as { parent_id: string; isError: boolean } | undefined;
    expect(errorTrm).toBeDefined();
    expect(errorTrm!.isError).toBe(true);
    // The error should NOT be at the root's id
    expect(errorTrm!.parent_id).not.toBe(root.id);
  });
});
