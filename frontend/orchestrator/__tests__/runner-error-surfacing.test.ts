import { runAgentTestSpec, type TestSpec } from '../test-spec-runner';
import {
  ErrorTool,
  EchoTool,
  PendingTool,
  TestAgent,
  fauxRegistration,
} from '@/agents/test-agent/test-agent';

describe('test-spec-runner error surfacing', () => {
  it('does NOT surface orchestrator errors when a server tool throws — agent recovers via isError toolResult', async () => {
    // After the orchestrator-level fix, server-side tool failures append an
    // isError toolResult to the log instead of killing the turn. The agent
    // sees the error and the next response (stop here) ends cleanly. No
    // "Orchestrator error" surfaces.
    const spec: TestSpec = {
      name: 'tool_throws_recovers',
      agent: 'TestAgent',
      parameters: { userMessage: 'go' },
      context: { userId: 'u', mode: 'org' },
      fauxResponses: [
        { type: 'toolUse', toolCalls: [{ name: 'ErrorTool', args: { reason: 'boom' } }] },
        { type: 'stop', text: 'recovered after tool error' },
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
