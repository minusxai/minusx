import { runAgentTestSpec, type TestSpec } from '../test-spec-runner';
import {
  ErrorTool,
  EchoTool,
  PendingTool,
  TestAgent,
  fauxRegistration,
} from '@/agents/test-agent/test-agent';

describe('test-spec-runner error surfacing', () => {
  it('surfaces orchestrator stream errors in failures', async () => {
    const spec: TestSpec = {
      name: 'tool_throws',
      agent: 'TestAgent',
      parameters: { userMessage: 'go' },
      context: { userId: 'u', mode: 'org' },
      fauxResponses: [
        { type: 'toolUse', toolCalls: [{ name: 'ErrorTool', args: { reason: 'boom' } }] },
        { type: 'stop', text: 'unreachable' },
      ],
      assertions: [{ kind: 'stopReached' }],
    };

    const { failures } = await runAgentTestSpec(
      spec,
      [EchoTool, PendingTool, ErrorTool, TestAgent],
      (steps) => fauxRegistration.setResponses(steps),
    );

    expect(failures.some((f) => f.startsWith('Orchestrator error:'))).toBe(true);
    expect(failures.some((f) => f.includes('ErrorTool exploded'))).toBe(true);
  });

  it('does NOT add an Orchestrator error for unknown tools (those are recoverable now)', async () => {
    const spec: TestSpec = {
      name: 'recover_from_unknown',
      agent: 'TestAgent',
      parameters: { userMessage: 'go' },
      context: { userId: 'u', mode: 'org' },
      fauxResponses: [
        { type: 'toolUse', toolCalls: [{ name: 'NotARealTool', args: {} }] },
        { type: 'stop', text: 'done' },
      ],
      assertions: [{ kind: 'stopReached' }],
    };

    const { failures, pass } = await runAgentTestSpec(
      spec,
      [EchoTool, PendingTool, ErrorTool, TestAgent],
      (steps) => fauxRegistration.setResponses(steps),
    );

    expect(pass).toBe(true);
    expect(failures).toEqual([]);
  });
});
