import { fauxAssistantMessage, fauxToolCall, type TextContent, type ToolCall } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext } from '@/orchestrator/types';
import { EchoTool, PendingTool, ErrorTool, DeepAgent, NestedAgent, TestAgent, fauxRegistration } from '../test-agent';

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
      { toolCallId: pendingCalls[0].id, response: { content: [{ type: 'text', text: 'one' }], isError: false } },
      { toolCallId: pendingCalls[1].id, response: { content: [{ type: 'text', text: 'two' }], isError: false } },
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
      { toolCallId: pendingCalls[2].id, response: { content: [{ type: 'text', text: 'three' }], isError: false } },
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
