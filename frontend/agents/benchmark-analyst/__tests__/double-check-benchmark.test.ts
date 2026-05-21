import type { Message, TextContent } from '@/orchestrator/llm';
import { fauxAssistantMessage } from '@/orchestrator/llm/testing';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { ConversationLogEntry } from '@/orchestrator/types';
import {
  BenchmarkAnalystAgent,
  fauxRegistration,
} from '../benchmark-analyst';
import {
  CheckEquivalence,
  DoubleCheckBenchmarkAgent,
  setJudgeModel,
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
  // Override the judge model to use the same faux provider as the analysts,
  // so scripted responses feed both analysts and the judge.
  let originalJudgeModel: ReturnType<typeof setJudgeModel>;
  beforeAll(() => {
    originalJudgeModel = setJudgeModel(fauxRegistration.getModel());
  });
  afterAll(() => {
    setJudgeModel(originalJudgeModel);
  });

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

  it('all three rounds disagree → returns last-round agent-1 answer (not a failure string)', async () => {
    fauxRegistration.setResponses([
      // Round 1 — analysts + judge.
      fauxAssistantMessage('TL;DR: 41', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: 42', { stopReason: 'stop' }),
      fauxAssistantMessage('DIFFERENT', { stopReason: 'stop' }),
      // Round 2 — analysts + judge.
      fauxAssistantMessage('TL;DR: 41 (r2)', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: 42 (r2)', { stopReason: 'stop' }),
      fauxAssistantMessage('DIFFERENT', { stopReason: 'stop' }),
      // Round 3 — analysts + judge. Still no agreement.
      fauxAssistantMessage('TL;DR: 41 (r3)', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: 42 (r3)', { stopReason: 'stop' }),
      fauxAssistantMessage('DIFFERENT', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const root = new DoubleCheckBenchmarkAgent(orch, { userMessage: 'What is 6 × 7?' }, CTX);
    const stream = orch.run(root);
    for await (const _ev of stream) { /* drain */ }
    const result = await stream.result();

    expect(result).not.toBeNull();
    expect(result!.stopReason).toBe('stop');
    // Final answer is r3-agent1's text — a real candidate the validator
    // can judge — not a hardcoded failure string. The cross-check signal
    // remains available via r3-check's `equivalent: false` details.
    expect((result!.content[0] as TextContent).text).toContain('TL;DR: 41 (r3)');
    expect((result!.content[0] as TextContent).text).not.toContain('Failed to reach consensus');

    // All three judges ran and all returned DIFFERENT — the disagreement
    // signal is preserved in the log for downstream consumers.
    const r1Check = findToolResult(orch.log, 'r1-check');
    const r2Check = findToolResult(orch.log, 'r2-check');
    const r3Check = findToolResult(orch.log, 'r3-check');
    expect((r1Check as { details?: { equivalent?: boolean } }).details?.equivalent).toBe(false);
    expect((r2Check as { details?: { equivalent?: boolean } }).details?.equivalent).toBe(false);
    expect((r3Check as { details?: { equivalent?: boolean } }).details?.equivalent).toBe(false);
  });

  it('round-1 & 2 disagree → round-3 consensus: returns round-3 agent 1 text', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage('TL;DR: 41', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: 42', { stopReason: 'stop' }),
      fauxAssistantMessage('DIFFERENT', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: 41 (r2)', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: 42 (r2)', { stopReason: 'stop' }),
      fauxAssistantMessage('DIFFERENT', { stopReason: 'stop' }),
      // Round 3 settles on a shared answer.
      fauxAssistantMessage('TL;DR: 42 (r3-final)', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: 42 (r3-final)', { stopReason: 'stop' }),
      fauxAssistantMessage('EQUIVALENT', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const root = new DoubleCheckBenchmarkAgent(orch, { userMessage: 'What is 6 × 7?' }, CTX);
    const stream = orch.run(root);
    for await (const _ev of stream) { /* drain */ }
    const result = await stream.result();

    expect(result).not.toBeNull();
    expect(result!.stopReason).toBe('stop');
    expect((result!.content[0] as TextContent).text).toContain('42 (r3-final)');

    // All nine slots present.
    for (const id of ['r1-agent1', 'r1-agent2', 'r1-check', 'r2-agent1', 'r2-agent2', 'r2-check', 'r3-agent1', 'r3-agent2', 'r3-check']) {
      expect(findToolResult(orch.log, id)).toBeDefined();
    }

    const r2Check = findToolResult(orch.log, 'r2-check');
    expect((r2Check as { details?: { equivalent?: boolean } }).details?.equivalent).toBe(false);
    const r3Check = findToolResult(orch.log, 'r3-check');
    expect((r3Check as { details?: { equivalent?: boolean } }).details?.equivalent).toBe(true);
  });

  it('round-3 analysts inherit full r1+r2 history (concatenation, own-side only)', async () => {
    // Round 1 + round 2 both diverge → round 3 fires. Each round-3
    // sub-agent's `threadHistory` should be the concatenation of its own
    // round-1 history and its own round-2 history, in order — proving
    // we use extractAgentHistory(r1-agentN) ++ extractAgentHistory(r2-agentN)
    // and not some interleaved or counterpart-leaking variant.
    fauxRegistration.setResponses([
      fauxAssistantMessage('TL;DR: 41', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: 42', { stopReason: 'stop' }),
      fauxAssistantMessage('DIFFERENT', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: 41-r2', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: 42-r2', { stopReason: 'stop' }),
      fauxAssistantMessage('DIFFERENT', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: 42 final', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: 42 final', { stopReason: 'stop' }),
      fauxAssistantMessage('EQUIVALENT', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const dispatchSpy = vi.spyOn(orch, 'dispatch');
    const root = new DoubleCheckBenchmarkAgent(orch, { userMessage: 'What is 6 × 7?' }, CTX);
    const stream = orch.run(root);
    for await (const _ev of stream) { /* drain */ }
    await stream.result();

    const r3AnalystsCall = dispatchSpy.mock.calls.find((args) => {
      const ids = (args[0].content as { type: string; id?: string }[])
        .filter((c) => c.type === 'toolCall')
        .map((c) => c.id);
      return ids.includes('r3-agent1') && ids.includes('r3-agent2');
    });
    expect(r3AnalystsCall).toBeDefined();

    const opts = r3AnalystsCall![2] as
      | { threadHistoryByToolCallId?: Record<string, Message[]> }
      | undefined;
    expect(opts?.threadHistoryByToolCallId).toBeDefined();
    const r3a1Hist = opts!.threadHistoryByToolCallId!['r3-agent1'];
    const r3a2Hist = opts!.threadHistoryByToolCallId!['r3-agent2'];
    expect(r3a1Hist).toBeDefined();
    expect(r3a2Hist).toBeDefined();

    // Shape: [user(orig), assistant(r1-stop), user(r1-feedback), assistant(r2-stop)].
    // Faux LLM stops immediately, so each round contributes one user + one
    // assistant turn (no intermediate tool-use turns).
    expect(r3a1Hist).toHaveLength(4);

    // [0] = original question (from r1-agent1's args)
    expect(r3a1Hist[0].role).toBe('user');
    expect(r3a1Hist[0].content).toBe('What is 6 × 7?');

    // [1] = r1-agent1's own stop turn (spliced from MXAgentDetails)
    expect((r3a1Hist[1] as { role: string }).role).toBe('assistant');

    // [2] = the r1-feedback prompt that became r2-agent1's userMessage —
    // a user turn embedded mid-history is the tell that r1's history was
    // followed by r2's history (whose synthesised user msg = r2-agent1's
    // args.userMessage = the round-1 feedback prompt).
    expect((r3a1Hist[2] as { role: string }).role).toBe('user');
    expect(r3a1Hist[2].content).toMatch(/Original question/);
    expect(r3a1Hist[2].content).toMatch(/TL;DR: 41/);   // own r1 answer
    expect(r3a1Hist[2].content).toMatch(/TL;DR: 42/);   // counterpart's r1 answer

    // [3] = r2-agent1's own stop turn
    expect((r3a1Hist[3] as { role: string }).role).toBe('assistant');

    // Own-side: r3-agent1 sees its own r1 ("TL;DR: 41") and own r2
    // ("TL;DR: 41-r2") in the assistant turns of the history — not the
    // counterpart's answers.
    const extractAssistantText = (msgs: Message[]): string =>
      msgs
        .filter((m): m is Message & { role: 'assistant' } => m.role === 'assistant')
        .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
        .filter((c): c is TextContent => c.type === 'text')
        .map((c) => c.text)
        .join('|');
    const a1Text = extractAssistantText(r3a1Hist);
    expect(a1Text).toContain('TL;DR: 41');
    expect(a1Text).toContain('TL;DR: 41-r2');
    expect(a1Text).not.toContain('TL;DR: 42-r2');

    const a2Text = extractAssistantText(r3a2Hist);
    expect(a2Text).toContain('TL;DR: 42');
    expect(a2Text).toContain('TL;DR: 42-r2');
    expect(a2Text).not.toContain('TL;DR: 41-r2');
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

  it('round-2 analysts inherit round-1 history via threadHistory (not just the feedback prompt)', async () => {
    // Round 1 produces divergent answers → judge says DIFFERENT → round 2
    // dispatches each analyst with the *other-counterpart-agnostic* feedback
    // prompt as the new user msg, but seeded with the matching round-1
    // sub-agent's thread (its synthesised user msg + every internal turn
    // pushed under it) as `threadHistory`. We assert on what dispatch was
    // actually called with — the threadHistory itself is not echoed in the
    // log (it only shapes the LLM call the sub-agent will make).
    fauxRegistration.setResponses([
      fauxAssistantMessage('TL;DR: 41', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: 42', { stopReason: 'stop' }),
      fauxAssistantMessage('DIFFERENT', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: 42 (revised)', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: 42 (revised)', { stopReason: 'stop' }),
      fauxAssistantMessage('EQUIVALENT', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const dispatchSpy = vi.spyOn(orch, 'dispatch');
    const root = new DoubleCheckBenchmarkAgent(orch, { userMessage: 'What is 6 × 7?' }, CTX);
    const stream = orch.run(root);
    for await (const _ev of stream) { /* drain */ }
    await stream.result();

    // dispatch should have been called 4 times: r1-analysts, r1-check,
    // r2-analysts, r2-check. The 3rd call (index 2) is the round-2
    // analysts dispatch — the one we threaded history through.
    expect(dispatchSpy.mock.calls.length).toBeGreaterThanOrEqual(4);

    const r2AnalystsCall = dispatchSpy.mock.calls.find((args) => {
      const msg = args[0];
      const ids = (msg.content as { type: string; id?: string }[])
        .filter((c) => c.type === 'toolCall')
        .map((c) => c.id);
      return ids.includes('r2-agent1') && ids.includes('r2-agent2');
    });
    expect(r2AnalystsCall).toBeDefined();

    const opts = r2AnalystsCall![2] as
      | { threadHistoryByToolCallId?: Record<string, Message[]> }
      | undefined;
    expect(opts).toBeDefined();
    expect(opts!.threadHistoryByToolCallId).toBeDefined();

    const r2a1Hist = opts!.threadHistoryByToolCallId!['r2-agent1'];
    const r2a2Hist = opts!.threadHistoryByToolCallId!['r2-agent2'];
    expect(r2a1Hist).toBeDefined();
    expect(r2a2Hist).toBeDefined();

    // History begins with the original round-1 user message and includes
    // the analyst's internal assistant turn(s). Faux responses for round 1
    // were single-shot `stopReason: 'stop'` messages, so each history is:
    // [user 'What is 6 × 7?', assistant 'TL;DR: 41' (or 42)].
    expect(r2a1Hist[0].role).toBe('user');
    expect(r2a1Hist[0].content).toBe('What is 6 × 7?');
    expect(r2a2Hist[0].role).toBe('user');
    expect(r2a2Hist[0].content).toBe('What is 6 × 7?');

    // Sub-agent's *own* round-1 answer is spliced in. Each analyst sees
    // its own prior reasoning — not the other's (that's in the feedback
    // prompt only). r1-agent1 said 'TL;DR: 41'; r1-agent2 said 'TL;DR: 42'.
    const extractAssistantText = (msgs: Message[]): string =>
      msgs
        .filter((m): m is Message & { role: 'assistant' } => m.role === 'assistant')
        .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
        .filter((c): c is TextContent => c.type === 'text')
        .map((c) => c.text)
        .join('|');
    expect(extractAssistantText(r2a1Hist)).toContain('TL;DR: 41');
    expect(extractAssistantText(r2a1Hist)).not.toContain('TL;DR: 42');
    expect(extractAssistantText(r2a2Hist)).toContain('TL;DR: 42');
    expect(extractAssistantText(r2a2Hist)).not.toContain('TL;DR: 41');

    // No system prompt in the history — by the orchestrator's `Message` type union
    // (`user | assistant | toolResult`), there is no 'system' role. The
    // round-2 sub-agent's system prompt is built fresh by
    // `MXAgent.llm()` via `getSystemPrompt()`, not inherited.
    const hasSystemRole = r2a1Hist.some(
      (m) => (m as { role?: string }).role === 'system',
    );
    expect(hasSystemRole).toBe(false);
  });

  it('extractAgentHistory: includes every interleaved assistant/toolResult turn under the invocation', async () => {
    // Seed a realistic multi-step trace under a single sub-agent
    // invocation: two tool-use rounds (SearchDBSchema → ExecuteQuery)
    // wrapped by a parent's synth-AssistantMessage that announces the
    // sub-agent toolCall. The sub-agent's final `stopReason: 'stop'`
    // turn lives only inside the parent's toolResult wrapper's
    // `MXAgentDetails.assistantMessage` (matching how
    // `appendAgentResult` records it in real runs).
    const parentId = 'parent-root';
    const subId = 'sub-1';
    const seedLog: ConversationLogEntry[] = [
      {
        type: 'toolCall',
        id: parentId,
        name: 'DoubleCheckBenchmarkAgent',
        arguments: { userMessage: 'outer' },
        context: CTX,
        parent_id: null,
      },
      // Parent's synth assistant message dispatching the sub-agent.
      {
        role: 'assistant',
        content: [{
          type: 'toolCall', id: subId, name: 'BenchmarkAnalystAgent',
          arguments: { userMessage: 'Find top revenue customer' },
        }],
        api: 'controller' as never, provider: 'controller', model: 'controller',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'toolUse', timestamp: Date.now(), parent_id: parentId,
      },
      // Sub-agent step 1: assistant{toolUse: SearchDBSchema} + its toolResult.
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me look at the schema first.' },
          { type: 'toolCall', id: 'tc-search', name: 'SearchDBSchema', arguments: { query: 'customers' } },
        ],
        api: 'faux' as never, provider: 'faux', model: 'stub',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'toolUse', timestamp: Date.now(), parent_id: subId,
      },
      {
        role: 'toolResult', toolCallId: 'tc-search', toolName: 'SearchDBSchema',
        content: [{ type: 'text', text: 'customers(id, name, revenue)' }],
        isError: false, timestamp: Date.now(), parent_id: subId,
      } as never,
      // Sub-agent step 2: assistant{toolUse: ExecuteQuery} + its toolResult.
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Now I will query for the top customer.' },
          { type: 'toolCall', id: 'tc-exec', name: 'ExecuteQuery', arguments: { sql: 'SELECT name FROM customers ORDER BY revenue DESC LIMIT 1' } },
        ],
        api: 'faux' as never, provider: 'faux', model: 'stub',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'toolUse', timestamp: Date.now(), parent_id: subId,
      },
      {
        role: 'toolResult', toolCallId: 'tc-exec', toolName: 'ExecuteQuery',
        content: [{ type: 'text', text: '{"rows":[["Acme"]]}' }],
        isError: false, timestamp: Date.now(), parent_id: subId,
      } as never,
      // Sub-agent's final stop turn lives ONLY inside the parent's
      // toolResult wrapper, not under subId — exactly as
      // `appendAgentResult` writes it.
      {
        role: 'toolResult', toolCallId: subId, toolName: 'BenchmarkAnalystAgent',
        content: [{ type: 'text', text: 'TL;DR: Acme' }],
        isError: false,
        details: {
          type: 'mx_agent',
          assistantMessage: {
            role: 'assistant',
            content: [{ type: 'text', text: 'TL;DR: Acme' }],
            api: 'faux' as never, provider: 'faux', model: 'stub',
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: 'stop',
            timestamp: Date.now(),
          },
        },
        timestamp: Date.now(), parent_id: parentId,
      } as never,
    ];

    const orch = new Orchestrator(REGISTRABLES, seedLog);
    const hist = orch.extractAgentHistory(subId);

    // Expected: [user, assistant(search), toolResult(search), assistant(exec),
    // toolResult(exec), assistant(stop "TL;DR: Acme")].
    expect(hist).toHaveLength(6);
    expect(hist[0].role).toBe('user');
    expect(hist[0].content).toBe('Find top revenue customer');

    // Step 1 — schema search.
    const a1 = hist[1] as { role: string; content: { type: string; name?: string; text?: string }[] };
    expect(a1.role).toBe('assistant');
    expect(a1.content.some((c) => c.type === 'toolCall' && c.name === 'SearchDBSchema')).toBe(true);
    const tr1 = hist[2] as { role: string; toolName: string };
    expect(tr1.role).toBe('toolResult');
    expect(tr1.toolName).toBe('SearchDBSchema');

    // Step 2 — execute query.
    const a2 = hist[3] as { role: string; content: { type: string; name?: string }[] };
    expect(a2.role).toBe('assistant');
    expect(a2.content.some((c) => c.type === 'toolCall' && c.name === 'ExecuteQuery')).toBe(true);
    const tr2 = hist[4] as { role: string; toolName: string };
    expect(tr2.role).toBe('toolResult');
    expect(tr2.toolName).toBe('ExecuteQuery');

    // Final stop turn — spliced in from MXAgentDetails (not under subId
    // directly). Must be there or round-2 agents miss the round-1 answer.
    const aFinal = hist[5] as { role: string; stopReason: string; content: { type: string; text?: string }[] };
    expect(aFinal.role).toBe('assistant');
    expect(aFinal.stopReason).toBe('stop');
    expect(aFinal.content.some((c) => c.type === 'text' && c.text === 'TL;DR: Acme')).toBe(true);
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

  it('uses primaryAgent / secondaryAgent static fields for sub-agent dispatch', async () => {
    // Custom analyst with a distinct schema.name. Renamed via a fresh
    // schema literal — the orchestrator dispatches sub-agents by name, so
    // overriding `primaryAgent`/`secondaryAgent` must drive both
    // dispatched names and registry lookup.
    class AlternateAnalyst extends BenchmarkAnalystAgent {
      static override readonly schema = {
        ...BenchmarkAnalystAgent.schema,
        name: 'AlternateAnalyst',
      };
    }
    class DoubleCheckAlt extends DoubleCheckBenchmarkAgent {
      static primaryAgent = AlternateAnalyst;
      static secondaryAgent = AlternateAnalyst;
    }

    fauxRegistration.setResponses([
      fauxAssistantMessage('TL;DR: 42', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: 42', { stopReason: 'stop' }),
      fauxAssistantMessage('EQUIVALENT', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator([
      AlternateAnalyst,
      CheckEquivalence,
      DoubleCheckAlt,
      // Tools the analyst would advertise — unused here (analyst stops on
      // first turn) but kept so registry validation is happy.
      ListDBConnections,
      BaseSearchDBSchema,
      BaseExecuteQuery,
    ]);
    const root = new DoubleCheckAlt(orch, { userMessage: 'q' }, CTX);
    const stream = orch.run(root);
    for await (const _ev of stream) { /* drain */ }
    const result = await stream.result();

    expect(result).not.toBeNull();
    // The sub-agent toolCalls in the log must reference the overridden name.
    const r1a1 = findToolCallInAssistantMsgs(orch.log, 'r1-agent1');
    const r1a2 = findToolCallInAssistantMsgs(orch.log, 'r1-agent2');
    expect((r1a1 as { name?: string }).name).toBe('AlternateAnalyst');
    expect((r1a2 as { name?: string }).name).toBe('AlternateAnalyst');
  });

  // Each analyst sub-agent should land on a distinct catalog cache key
  // (`agent-a` / `agent-b`) so their `sample_rows` / `sample_notes` are
  // picked from different lighter-model passes — input-level diversity
  // that helps the two sub-agents avoid converging on the same data-shape
  // misreading. Surface via dispatch's `contextOverridesByToolCallId` so
  // each sub-tool's resolved context carries its slot id.
  it('routes sub-agents to distinct catalogKey slots via context overrides', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage('TL;DR: 42', { stopReason: 'stop' }),
      fauxAssistantMessage('TL;DR: 42', { stopReason: 'stop' }),
      fauxAssistantMessage('EQUIVALENT', { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const dispatchSpy = vi.spyOn(orch, 'dispatch');
    const root = new DoubleCheckBenchmarkAgent(orch, { userMessage: 'q' }, CTX);
    const stream = orch.run(root);
    for await (const _ev of stream) { /* drain */ }
    await stream.result();

    // Find the round-1 analyst dispatch (the message that carries both
    // r1-agent1 and r1-agent2 toolCalls).
    const r1Dispatch = dispatchSpy.mock.calls.find((args) => {
      const ids = (args[0].content as { type: string; id?: string }[])
        .filter((c) => c.type === 'toolCall')
        .map((c) => c.id);
      return ids.includes('r1-agent1') && ids.includes('r1-agent2');
    });
    expect(r1Dispatch).toBeDefined();

    const opts = r1Dispatch![2] as
      | { contextOverridesByToolCallId?: Record<string, Record<string, unknown>> }
      | undefined;
    expect(opts).toBeDefined();
    expect(opts!.contextOverridesByToolCallId).toBeDefined();
    expect(opts!.contextOverridesByToolCallId!['r1-agent1']).toEqual({ catalogKey: 'agent-a' });
    expect(opts!.contextOverridesByToolCallId!['r1-agent2']).toEqual({ catalogKey: 'agent-b' });
  });
});
