import { fauxAssistantMessage, fauxToolCall, type TextContent, type ToolCall } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { AgentContext, ConversationLogEntry } from '@/orchestrator/types';
import { EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent, fauxRegistration } from '../test-agent';

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
    const orch = new Orchestrator([EchoTool, PendingTool, ErrorTool, NestedAgent, TestAgent]);
    const root = new TestAgent(orch, { userMessage: 'root input' }, ctx);

    const phase1 = orch.run(root);
    const events1 = [];
    for await (const ev of phase1) events1.push(ev);
    const result1 = await phase1.result();

    expect(result1).toBeNull();
    expect(events1.at(-1)).toMatchObject({ type: 'pending' });

    const pendingCall = orch.log
      .flatMap((e) => ('role' in e && e.role === 'assistant' ? e.content.filter((c) => c.type === 'toolCall') : []))
      .find((tc): tc is ToolCall => tc.name === 'PendingTool');
    expect(pendingCall).toBeDefined();

    const phase2 = orch.resume([
      {
        toolCallId: pendingCall!.id,
        response: { content: [{ type: 'text', text: 'frontend completed it' }], isError: false },
      },
    ]);
    for await (const _ of phase2) {/* drain */}
    const result2 = await phase2.result();

    expect(result2).not.toBeNull();
    expect(result2!.role).toBe('assistant');
    expect(result2!.stopReason).toBe('stop');
    expect((result2!.content[0] as TextContent).text).toContain('Root done.');

    const log: ConversationLogEntry[] = orch.log;

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
