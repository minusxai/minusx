/**
 * Headless AnalystAgent test.
 *
 * Imports `AnalystAgent` from `agents/src` and runs it through the real
 * `agentLoop` with a mock LLM (MockStreamFn). Proves the entire `agents/`
 * module loads in pure node ESM context (no Next.js, no PGLite, no browser).
 *
 * The mock LLM drives a tool call to `CannotAnswer` (a pure-JS tool that
 * doesn't touch the filesystem, network, or database) and we assert the
 * result was recorded in the conversation log.
 */
import type { Model } from '@mariozechner/pi-ai';
import { runAgent } from '../run-agent';
import type { ConversationLogEntry } from '../conversation';
import type { RunContext } from '../types';
import { MockStreamFn } from './mock-stream-fn';

const mockModel: Model<any> = {
  id: 'mock-model',
  name: 'Mock',
  api: 'openai-completions',
  provider: 'openai',
  baseUrl: 'http://mock',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as Model<any>;

describe('headless AnalystAgent', () => {
  it('imports cleanly and runs to completion via real agentLoop', async () => {
    // Lazy import so failure here is clearly attributed to "loading agents/" rather than test setup.
    const { AnalystAgent } = await import('../../../agents/src');

    const agent = new AnalystAgent({
      goal: 'Eval test',
      // No connection / schema / appState — exercising pure-JS tools only.
    });

    const ctx: RunContext = { model: mockModel };

    const mock = new MockStreamFn();
    // Turn 1: LLM decides it can't answer with the available data.
    // Turn 2: LLM stops normally with a final reply.
    mock.configure([
      [{ type: 'toolCall', id: 'tc-1', name: 'CannotAnswer', arguments: { reason: 'no data provided' } }],
      [{ type: 'text', text: 'I could not answer.' }],
    ]);

    const result = await runAgent(agent, 'Compute revenue for Q3', [], ctx, mock.asStreamFn());

    expect(result.state).toBe('success');
    if (result.state === 'success') {
      expect(result.content).toBe('I could not answer.');

      // Verify the CannotAnswer tool actually executed and its result was logged.
      const taskResults = result.logDiff.filter(
        (e): e is ConversationLogEntry & { _type: 'task_result' } => e._type === 'task_result',
      );
      const cannotAnswerResult = taskResults
        .map((r) => r.result)
        .find((r) => r && typeof r === 'object' && 'cannot_answer' in r);
      expect(cannotAnswerResult).toEqual({
        submitted: true,
        cannot_answer: true,
        reason: 'no data provided',
      });
    }

    // Mock was called twice: once for the tool-use turn, once for the final reply.
    expect(mock.calls).toBe(2);
  });

  it('SlackAgent loads with restricted tool set', async () => {
    const { SlackAgent } = await import('../../../agents/src');
    const agent = new SlackAgent({ goal: 'Slack eval' });

    // SlackAgent should have fewer tools than AnalystAgent (no EditFile, CreateFile, etc.)
    const toolNames = agent.tools.map((t) => t.name);
    expect(toolNames).toContain('ReadFiles');
    expect(toolNames).toContain('ExecuteQuery');
    expect(toolNames).toContain('SearchDBSchema');
    expect(toolNames).not.toContain('EditFile');
    expect(toolNames).not.toContain('CreateFile');
    expect(toolNames).not.toContain('PublishAll');
  });
});
