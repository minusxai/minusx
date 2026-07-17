/**
 * Regression: after a frontend-tool pause/resume, the resumed root agent's LLM context
 * contained the ENTIRE CURRENT TURN TWICE — the user message and every committed entry.
 *
 * Root cause: `reconstructAgent` (resume path) builds the paused root with
 * `threadHistory = projectRootThreadHistory()`, which walks the saved log INCLUDING the
 * current turn's own root invocation (committed eagerly at turn start) and its entries —
 * and ALSO `toolThread = collectToolThread(rootId)`, the same entries again.
 * `buildLLMContext` then emits: [user, turn-so-far, user again, turn-so-far again].
 *
 * Observed in production (712KB request for a one-turn conversation; the "duplicate user
 * message"): the stored log was clean — the duplication was in-memory, on every LLM call
 * after the first frontend-tool resume (EditFile/CreateFile/Navigate/Clarify flows).
 * projectRootThreadHistory must exclude the invocation being reconstructed: prior turns
 * are history; the current turn lives in the toolThread.
 */
import type { AgentContext } from '@/orchestrator/types';
import type { Message, TextContent, ToolCall } from '@/orchestrator/llm';
import { fauxAssistantMessage, fauxToolCall } from '@/orchestrator/llm/testing';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent, fauxRegistration } from '@/agents/test-agent/test-agent';

const ctx: AgentContext = { userId: 'u', mode: 'org' };
const REGISTRABLES = [EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent];

const pendingCallIn = (orch: Orchestrator): ToolCall => {
  const tc = orch.log
    .flatMap((e) => ('role' in e && e.role === 'assistant' ? e.content.filter((c) => c.type === 'toolCall') : []))
    .find((c): c is ToolCall => c.name === 'PendingTool');
  expect(tc).toBeDefined();
  return tc!;
};

const completion = (tc: ToolCall) => ({
  role: 'toolResult' as const,
  toolCallId: tc.id,
  toolName: 'PendingTool',
  content: [{ type: 'text' as const, text: 'frontend completed it' }],
  isError: false,
  timestamp: Date.now(),
});

const textOf = (m: Message): string =>
  typeof m.content === 'string'
    ? m.content
    : m.content.filter((b): b is TextContent => b.type === 'text').map((b) => b.text).join('\n');

describe('resume: the current turn must not be duplicated into threadHistory', () => {
  it('single-turn pause/resume → the next LLM call sees the user message and each entry exactly ONCE', async () => {
    // Turn: echo (server tool), then a frontend pause, then (post-resume) a captured call.
    fauxRegistration.setResponses([
      fauxAssistantMessage([fauxToolCall('EchoTool', { text: 'step one' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('PendingTool', { prompt: 'frontend please' })], { stopReason: 'toolUse' }),
    ]);

    const orchA = new Orchestrator(REGISTRABLES);
    const root = new TestAgent(orchA, { userMessage: 'update my dashboard' }, ctx);
    const phase1 = orchA.run(root);
    for await (const _ of phase1) { /* drain */ }
    expect(await phase1.result()).toBeNull(); // paused

    let captured: Message[] | null = null;
    fauxRegistration.setResponses([
      (context) => {
        captured = context.messages;
        return fauxAssistantMessage('all done', { stopReason: 'stop' });
      },
    ]);

    // Fresh orchestrator over the saved log — exactly what the resume POST does.
    const orchB = new Orchestrator(REGISTRABLES, [...orchA.log]);
    const phase2 = orchB.resume([completion(pendingCallIn(orchA))]);
    for await (const _ of phase2) { /* drain */ }
    await phase2.result();

    expect(captured).not.toBeNull();
    const messages = captured! as Message[];

    // The user message appears exactly once.
    const userMsgs = messages.filter((m) => m.role === 'user' && textOf(m).includes('update my dashboard'));
    expect(userMsgs).toHaveLength(1);

    // Each turn entry appears exactly once: one EchoTool tool_use, one echo result,
    // one PendingTool tool_use, one PendingTool result.
    const toolUses = messages
      .filter((m) => m.role === 'assistant')
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((b): b is ToolCall => b.type === 'toolCall');
    expect(toolUses.filter((t) => t.name === 'EchoTool')).toHaveLength(1);
    expect(toolUses.filter((t) => t.name === 'PendingTool')).toHaveLength(1);

    const toolResults = messages.filter((m) => m.role === 'toolResult');
    expect(toolResults).toHaveLength(2);
  });

  it('multi-turn: prior turns appear once as history, the current turn once as the live thread', async () => {
    // ---- Turn 1: completes normally ----
    fauxRegistration.setResponses([
      fauxAssistantMessage([fauxToolCall('EchoTool', { text: 'turn one work' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('turn one done', { stopReason: 'stop' }),
    ]);
    const orch1 = new Orchestrator(REGISTRABLES);
    const root1 = new TestAgent(orch1, { userMessage: 'first request' }, ctx);
    const s1 = orch1.run(root1);
    for await (const _ of s1) { /* drain */ }
    await s1.result();

    // ---- Turn 2: pauses on a frontend tool ----
    fauxRegistration.setResponses([
      fauxAssistantMessage([fauxToolCall('PendingTool', { prompt: 'frontend please' })], { stopReason: 'toolUse' }),
    ]);
    const orch2 = new Orchestrator(REGISTRABLES, [...orch1.log]);
    const root2 = new TestAgent(orch2, { userMessage: 'second request' }, ctx);
    const s2 = orch2.run(root2);
    for await (const _ of s2) { /* drain */ }
    expect(await s2.result()).toBeNull(); // paused

    // ---- Resume turn 2, capture the model's context ----
    let captured: Message[] | null = null;
    fauxRegistration.setResponses([
      (context) => {
        captured = context.messages;
        return fauxAssistantMessage('turn two done', { stopReason: 'stop' });
      },
    ]);
    const orch3 = new Orchestrator(REGISTRABLES, [...orch2.log]);
    const s3 = orch3.resume([completion(pendingCallIn(orch2))]);
    for await (const _ of s3) { /* drain */ }
    await s3.result();

    const messages = captured! as Message[];
    // Exactly one of each user turn.
    expect(messages.filter((m) => m.role === 'user' && textOf(m).includes('first request'))).toHaveLength(1);
    expect(messages.filter((m) => m.role === 'user' && textOf(m).includes('second request'))).toHaveLength(1);
    // Turn 1's history (assistant tool_use + result + final reply) present exactly once.
    const toolUses = messages
      .filter((m) => m.role === 'assistant')
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((b): b is ToolCall => b.type === 'toolCall');
    expect(toolUses.filter((t) => t.name === 'EchoTool')).toHaveLength(1);
    expect(toolUses.filter((t) => t.name === 'PendingTool')).toHaveLength(1);
  });
});
