import { fauxAssistantMessage, fauxToolCall, type TextContent, type ToolCall } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext } from '@/orchestrator/types';
import { EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent, fauxRegistration } from '../test-agent';

describe('multi-resume (pause → resume → pause again → resume again)', () => {
  it('handles two consecutive pause/resume cycles within a single run', async () => {
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
    const orch = new Orchestrator([EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent]);
    const agent = new TestAgent(orch, { userMessage: 'multi-pause' }, ctx);

    const phase1 = orch.run(agent);
    for await (const _ of phase1) {/* drain */}
    expect(await phase1.result()).toBeNull();

    const firstPendingId = orch.log
      .flatMap((e) => ('role' in e && e.role === 'assistant' ? e.content.filter((c) => c.type === 'toolCall') : []))
      .find((tc): tc is ToolCall => tc.name === 'PendingTool')!.id;

    const phase2 = orch.resume([
      { toolCallId: firstPendingId, response: { content: [{ type: 'text', text: 'first done' }], isError: false } },
    ]);
    for await (const _ of phase2) {/* drain */}
    expect(await phase2.result()).toBeNull();

    const allPending = orch.log
      .flatMap((e) => ('role' in e && e.role === 'assistant' ? e.content.filter((c) => c.type === 'toolCall') : []))
      .filter((tc): tc is ToolCall => tc.name === 'PendingTool');
    expect(allPending).toHaveLength(2);
    const secondPendingId = allPending.find((tc) => tc.id !== firstPendingId)!.id;

    const phase3 = orch.resume([
      { toolCallId: secondPendingId, response: { content: [{ type: 'text', text: 'second done' }], isError: false } },
    ]);
    for await (const _ of phase3) {/* drain */}
    const final = await phase3.result();

    expect(final).not.toBeNull();
    expect(final!.role).toBe('assistant');
    expect(final!.stopReason).toBe('stop');
    expect((final!.content[0] as TextContent).text).toContain('All done at last.');

    const resolvedToolCalls = orch.log.filter(
      (e) => 'role' in e && e.role === 'toolResult' && e.toolName === 'PendingTool',
    );
    expect(resolvedToolCalls).toHaveLength(2);
  });
});
