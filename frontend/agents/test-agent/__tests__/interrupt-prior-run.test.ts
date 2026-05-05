import { fauxAssistantMessage, fauxToolCall, type TextContent } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext } from '@/orchestrator/types';
import { EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent, fauxRegistration } from '../test-agent';

describe('interrupt prior run', () => {
  it('starting a new run while a prior run is paused appends synthetic interrupted ToolResults', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('PendingTool', { prompt: 'will be interrupted' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Agent B is fine.', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const orch = new Orchestrator([EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent]);

    const agentA = new TestAgent(orch, { userMessage: 'first run' }, ctx);
    const streamA = orch.run(agentA);
    for await (const _ of streamA) {/* drain to pending */}
    const resultA = await streamA.result();
    expect(resultA).toBeNull();

    const pendingToolCallId = orch.log
      .flatMap((e) => ('role' in e && e.role === 'assistant' ? e.content.filter((c) => c.type === 'toolCall') : []))
      .find((tc) => tc.name === 'PendingTool')!.id;

    const agentB = new TestAgent(orch, { userMessage: 'second run' }, ctx);
    const streamB = orch.run(agentB);
    for await (const _ of streamB) {/* drain */}
    const resultB = await streamB.result();

    const interruptedResult = orch.log.find(
      (e): e is typeof e & { role: 'toolResult'; toolCallId: string; toolName: string; isError: boolean; content: TextContent[] } =>
        'role' in e && e.role === 'toolResult' && e.toolCallId === pendingToolCallId,
    );
    expect(interruptedResult).toBeDefined();
    expect(interruptedResult!.toolName).toBe('PendingTool');
    expect(interruptedResult!.isError).toBe(true);
    expect(interruptedResult!.content[0].text).toBe('interrupted');
    expect(interruptedResult!.parent_id).toBe(agentA.id);

    expect(resultB).not.toBeNull();
    expect(resultB!.role).toBe('assistant');
    expect(resultB!.stopReason).toBe('stop');
    expect((resultB!.content[0] as TextContent).text).toContain('Agent B is fine.');

    const agentBStop = orch.log.find(
      (e) =>
        'role' in e &&
        e.role === 'assistant' &&
        e.parent_id === agentB.id &&
        e.stopReason === 'stop',
    );
    expect(agentBStop).toBeDefined();
  });
});
