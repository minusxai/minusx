import { fauxAssistantMessage, fauxToolCall, type TextContent, type ToolCall } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext, StreamEvent } from '@/orchestrator/types';
import { EchoTool, PendingTool, TestAgent, fauxRegistration } from '../test-agent';

describe('orchestrator e2e', () => {
  it('runs, pauses on pending tool call, resumes, returns final result', async () => {
    fauxRegistration.setResponses([
      fauxAssistantMessage([fauxToolCall('PendingTool', { prompt: 'frontend please' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('All done!', { stopReason: 'stop' }),
    ]);

    const ctx: AgentContext = { userId: 'u', mode: 'org' };
    const orch = new Orchestrator([EchoTool, PendingTool, TestAgent]);
    const agent = new TestAgent(orch, { userMessage: 'hi' }, ctx);

    const phase1 = orch.run(agent);
    const events1: StreamEvent[] = [];
    for await (const ev of phase1) events1.push(ev);
    const result1 = await phase1.result();

    expect(events1.length).toBeGreaterThan(0);
    expect(events1.at(-1)).toMatchObject({ type: 'pending' });
    expect(result1).toBeNull();

    const pendingCall = orch.log
      .flatMap((e) => ('role' in e && e.role === 'assistant' ? e.content.filter((c) => c.type === 'toolCall') : []))
      .find((tc): tc is ToolCall => tc.name === 'PendingTool');
    expect(pendingCall).toBeDefined();

    const phase2 = orch.resume([
      {
        toolCallId: pendingCall!.id,
        response: {
          content: [{ type: 'text', text: 'frontend completed it' }],
          isError: false,
        },
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
