import { fauxAssistantMessage, fauxToolCall, type TextContent, type ToolCall } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext, ConversationLog } from '@/orchestrator/types';
import { EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent, fauxRegistration } from '../test-agent';

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
      { toolCallId: pendingId, response: { content: [{ type: 'text', text: 'host completed it' }], isError: false } },
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
