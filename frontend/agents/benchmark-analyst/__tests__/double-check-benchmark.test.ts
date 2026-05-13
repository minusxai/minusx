import { fauxAssistantMessage, type TextContent } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { ConversationLogEntry } from '@/orchestrator/types';
import {
  BenchmarkAnalystAgent,
  fauxRegistration,
} from '../benchmark-analyst';
import {
  CheckEquivalence,
  DoubleCheckBenchmarkAgent,
} from '../double-check-benchmark';
import {
  BaseExecuteQuery,
  BaseSearchDBSchema,
  ListDBConnections,
} from '../db-tools';
import type { BenchmarkAnalystContext } from '../types';

// Production `BaseExecuteQuery` / `BaseSearchDBSchema` would try to build
// real DuckDB connectors from ctx.connections[*].config. Our LLM responses
// are pure stop messages (no DB tool calls), so the analyst sub-agents
// never actually invoke their DB tools — but if a future test wires
// non-stop analyst responses, mock these chokepoints.
vi.mock('@/lib/connections/run-query', () => ({
  runQuery: vi.fn(async (_db: string, query: string) => ({
    columns: [], types: [], rows: [], finalQuery: query,
  })),
}));
vi.mock('@/lib/connections/load-schema', () => ({
  loadConnectionSchema: vi.fn(async () => []),
}));

const REGISTRABLES = [
  ListDBConnections,
  BaseSearchDBSchema,
  BaseExecuteQuery,
  BenchmarkAnalystAgent,
  CheckEquivalence,
  DoubleCheckBenchmarkAgent,
];

const CTX: BenchmarkAnalystContext = {
  connections: [
    { name: 'test_db', dialect: 'duckdb', description: 'test conn', config: { file_path: '/nonexistent/test.duckdb' } },
  ],
  contextDocs: 'test docs',
};

function findToolResult(log: ConversationLogEntry[], toolCallId: string) {
  return log.find(
    (e) => 'role' in e && e.role === 'toolResult' && e.toolCallId === toolCallId,
  );
}

function findToolCallInAssistantMsgs(log: ConversationLogEntry[], id: string) {
  return log
    .flatMap((e) => ('role' in e && e.role === 'assistant' ? e.content : []))
    .find((c) => c.type === 'toolCall' && c.id === id);
}

describe('DoubleCheckBenchmarkAgent', () => {
  it('round-1 consensus: returns agent 1 text; only one round dispatched', async () => {
    fauxRegistration.setResponses([
      // The two analysts run in parallel; both get the same scripted reply.
      // (Faux model consumes responses in arrival order; since both
      //  responses are identical, race order is irrelevant.)
      fauxAssistantMessage('TL;DR: 42\nAnalysis: forty-two.', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: 42\nAnalysis: forty-two.', { stopReason: 'stop' }),
      fauxAssistantMessage('EQUIVALENT', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const root = new DoubleCheckBenchmarkAgent(orch, { userMessage: 'What is 6 × 7?' }, CTX);
    const stream = orch.run(root);
    for await (const _ev of stream) { /* drain */ }
    const result = await stream.result();

    // Final answer = round-1 agent 1 text.
    expect(result).not.toBeNull();
    expect(result!.stopReason).toBe('stop');
    expect((result!.content[0] as TextContent).text).toContain('TL;DR: 42');

    // Both round-1 analyst slots completed.
    expect(findToolCallInAssistantMsgs(orch.log, 'r1-agent1')).toBeDefined();
    expect(findToolCallInAssistantMsgs(orch.log, 'r1-agent2')).toBeDefined();
    expect(findToolResult(orch.log, 'r1-agent1')).toBeDefined();
    expect(findToolResult(orch.log, 'r1-agent2')).toBeDefined();

    // Judge ran, said EQUIVALENT.
    const r1Check = findToolResult(orch.log, 'r1-check');
    expect(r1Check).toBeDefined();
    expect((r1Check as { details?: { equivalent?: boolean } }).details?.equivalent).toBe(true);

    // Round 2 was NOT dispatched.
    expect(findToolCallInAssistantMsgs(orch.log, 'r2-agent1')).toBeUndefined();
    expect(findToolCallInAssistantMsgs(orch.log, 'r2-agent2')).toBeUndefined();
    expect(findToolResult(orch.log, 'r2-check')).toBeUndefined();

    // Sub-agent invocations are parented to the DoubleCheck root, not null.
    const r1a1Call = findToolCallInAssistantMsgs(orch.log, 'r1-agent1');
    expect(r1a1Call).toBeDefined();
    expect(r1a1Call!.type).toBe('toolCall');
    expect((r1a1Call as { name?: string }).name).toBe('BenchmarkAnalystAgent');
  });

  it('round-1 disagreement → round-2 consensus: returns round-2 agent 1 text', async () => {
    fauxRegistration.setResponses([
      // Round 1: divergent answers.
      fauxAssistantMessage('TL;DR: 41', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: 42', { stopReason: 'stop' }),
      fauxAssistantMessage('DIFFERENT', { stopReason: 'stop' }),
      // Round 2: cross-feedback brings them together.
      fauxAssistantMessage('TL;DR: 42 (revised)', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: 42 (revised)', { stopReason: 'stop' }),
      fauxAssistantMessage('EQUIVALENT', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const root = new DoubleCheckBenchmarkAgent(orch, { userMessage: 'What is 6 × 7?' }, CTX);
    const stream = orch.run(root);
    for await (const _ev of stream) { /* drain */ }
    const result = await stream.result();

    expect(result).not.toBeNull();
    expect(result!.stopReason).toBe('stop');
    expect((result!.content[0] as TextContent).text).toContain('42 (revised)');

    // All six slots present.
    expect(findToolResult(orch.log, 'r1-agent1')).toBeDefined();
    expect(findToolResult(orch.log, 'r1-agent2')).toBeDefined();
    expect(findToolResult(orch.log, 'r1-check')).toBeDefined();
    expect(findToolResult(orch.log, 'r2-agent1')).toBeDefined();
    expect(findToolResult(orch.log, 'r2-agent2')).toBeDefined();
    expect(findToolResult(orch.log, 'r2-check')).toBeDefined();

    // Verdicts are recorded.
    const r1Check = findToolResult(orch.log, 'r1-check');
    expect((r1Check as { details?: { equivalent?: boolean } }).details?.equivalent).toBe(false);
    const r2Check = findToolResult(orch.log, 'r2-check');
    expect((r2Check as { details?: { equivalent?: boolean } }).details?.equivalent).toBe(true);
  });

  it('both rounds disagree → "Failed to reach consensus"', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage('TL;DR: 41', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: 42', { stopReason: 'stop' }),
      fauxAssistantMessage('DIFFERENT', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: 41', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: 42', { stopReason: 'stop' }),
      fauxAssistantMessage('DIFFERENT', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const root = new DoubleCheckBenchmarkAgent(orch, { userMessage: 'What is 6 × 7?' }, CTX);
    const stream = orch.run(root);
    for await (const _ev of stream) { /* drain */ }
    const result = await stream.result();

    expect(result).not.toBeNull();
    expect(result!.stopReason).toBe('stop');
    expect((result!.content[0] as TextContent).text).toContain('Failed to reach consensus');

    const r2Check = findToolResult(orch.log, 'r2-check');
    expect((r2Check as { details?: { equivalent?: boolean } }).details?.equivalent).toBe(false);
  });

  it('context flows to sub-agents via dispatch (sub-agent.context === DoubleCheck.context)', async () => {
    // Sub-agent toolCalls live inside their parent's synth AssistantMessage
    // `.content`, not as standalone `AgentInvocation` log entries — so the
    // `context` we passed to DoubleCheck isn't materialised on any
    // toolCall object. The propagation happens at runtime when
    // `Orchestrator.dispatch` calls `instantiate(Cls, params, parent.context, …)`.
    //
    // Verifying directly would require a constructor spy; instead we use
    // an observable side-effect — `BenchmarkAnalystAgent.getSystemPrompt`
    // reads `this.context.connections` and `this.context.contextDocs`
    // (passing them through `JSON.stringify`). If the dispatch failed to
    // propagate context, that call would throw at `(this.context.connections ?? []).map(...)`
    // semantics on a missing `context`, the agent's `run` would not
    // produce a `stopReason: 'stop'`, and the controller wouldn't reach
    // its judge / final-answer path. A clean end-to-end run therefore
    // proves the sub-agent received the same context object.
    fauxRegistration.setResponses([
      fauxAssistantMessage('TL;DR: ctx ok', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: ctx ok', { stopReason: 'stop' }),
      fauxAssistantMessage('EQUIVALENT', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const root = new DoubleCheckBenchmarkAgent(orch, { userMessage: 'Q' }, CTX);
    const stream = orch.run(root);
    for await (const _ev of stream) { /* drain */ }
    const result = await stream.result();

    expect(result).not.toBeNull();
    expect(result!.stopReason).toBe('stop');
    expect((result!.content[0] as TextContent).text).toContain('TL;DR: ctx ok');

    // Both round-1 sub-agents completed successfully (their
    // `getSystemPrompt` would have read this.context.connections).
    expect(findToolResult(orch.log, 'r1-agent1')).toBeDefined();
    expect(findToolResult(orch.log, 'r1-agent2')).toBeDefined();
  });

  it('resumability: pre-populating round-1 results in the log skips re-dispatching round 1', async () => {
    // Set up an orchestrator with a "completed" round 1 already in the
    // log (as if DoubleCheck started, finished round 1, then was
    // interrupted before round 2). On the new run, only round 2's three
    // LLM responses should be consumed.
    fauxRegistration.setResponses([
      // Only round 2's three calls — round 1 must be skipped via toolThread lookup.
      fauxAssistantMessage('TL;DR: agreed', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: agreed', { stopReason: 'stop' }),
      fauxAssistantMessage('EQUIVALENT', { stopReason: 'stop' }),
    ]);

    const rootId = 'root-double-check';
    const a1Id = 'r1-agent1';
    const a2Id = 'r1-agent2';
    const checkId = 'r1-check';

    // Seed log: root invocation + a synth assistant message announcing
    // round 1's three toolCalls + their toolResults (judge said DIFFERENT
    // so round 2 is required).
    const seedLog: ConversationLogEntry[] = [
      {
        type: 'toolCall',
        id: rootId,
        name: 'DoubleCheckBenchmarkAgent',
        arguments: { userMessage: 'Q' },
        context: CTX,
        parent_id: null,
      },
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: a1Id, name: 'BenchmarkAnalystAgent', arguments: { userMessage: 'Q' } },
          { type: 'toolCall', id: a2Id, name: 'BenchmarkAnalystAgent', arguments: { userMessage: 'Q' } },
        ],
        api: 'controller' as never,
        provider: 'controller',
        model: 'controller',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'toolUse',
        timestamp: Date.now(),
        parent_id: rootId,
      },
      // Round-1 agent-1 result, wrapped as an MXAgent ToolResultMessage.
      {
        role: 'toolResult',
        toolCallId: a1Id,
        toolName: 'BenchmarkAnalystAgent',
        content: [{ type: 'text', text: 'TL;DR: prior-1' }],
        isError: false,
        details: {
          type: 'mx_agent',
          assistantMessage: {
            role: 'assistant',
            content: [{ type: 'text', text: 'TL;DR: prior-1' }],
            api: 'faux', provider: 'faux', model: 'stub',
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: 'stop',
            timestamp: Date.now(),
          },
        },
        timestamp: Date.now(),
        parent_id: rootId,
      } as never,
      {
        role: 'toolResult',
        toolCallId: a2Id,
        toolName: 'BenchmarkAnalystAgent',
        content: [{ type: 'text', text: 'TL;DR: prior-2' }],
        isError: false,
        details: {
          type: 'mx_agent',
          assistantMessage: {
            role: 'assistant',
            content: [{ type: 'text', text: 'TL;DR: prior-2' }],
            api: 'faux', provider: 'faux', model: 'stub',
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: 'stop',
            timestamp: Date.now(),
          },
        },
        timestamp: Date.now(),
        parent_id: rootId,
      } as never,
      // Round 1 assistant message for the judge invocation.
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: checkId, name: 'CheckEquivalence', arguments: { question: 'Q', answerA: 'TL;DR: prior-1', answerB: 'TL;DR: prior-2' } },
        ],
        api: 'controller' as never,
        provider: 'controller',
        model: 'controller',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'toolUse',
        timestamp: Date.now(),
        parent_id: rootId,
      },
      // Round-1 judge result: DIFFERENT, so round 2 is required on resume.
      {
        role: 'toolResult',
        toolCallId: checkId,
        toolName: 'CheckEquivalence',
        content: [{ type: 'text', text: '{"equivalent":false}' }],
        isError: false,
        details: { equivalent: false, rawVerdict: 'DIFFERENT' },
        timestamp: Date.now(),
        parent_id: rootId,
      } as never,
    ];

    const orch = new Orchestrator(REGISTRABLES, seedLog);
    // Use reconstructAgent to set up the agent's toolThread from the log.
    const agent = orch.reconstructAgent(rootId) as DoubleCheckBenchmarkAgent;
    const stream = orch.run(agent);
    for await (const _ev of stream) { /* drain */ }
    const result = await stream.result();

    // The agent should have used the pre-existing round-1 results
    // (prior-1 / prior-2) for building feedback, then dispatched round 2
    // (consuming exactly the 3 scripted responses), then returned the
    // round-2 agent-1 text.
    expect(result).not.toBeNull();
    expect((result!.content[0] as TextContent).text).toContain('TL;DR: agreed');

    // The seeded round-1 toolResults still appear in the final log;
    // round-1 was not re-dispatched (we'd have seen an "out of responses"
    // failure from the faux model if it had been).
    expect(findToolResult(orch.log, 'r1-agent1')).toBeDefined();
    expect(findToolResult(orch.log, 'r1-check')).toBeDefined();
    expect(findToolResult(orch.log, 'r2-check')).toBeDefined();
  });
});
