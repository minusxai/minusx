import { fauxAssistantMessage, fauxToolCall, type TextContent, type ToolCall } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext } from '@/orchestrator/types';
import { EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent, fauxRegistration } from '../test-agent';

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
