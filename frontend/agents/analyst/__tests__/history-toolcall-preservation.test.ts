/**
 * Regression test for: tool calls vanish from chat history on follow-up turns.
 *
 * Symptom (observed in production raw-LLM logs): after AnalystAgent makes a
 * tool call (e.g. EditFile / ExecuteQuery) and replies with text, the NEXT
 * turn's prompt to the model shows the prior assistant message as text-only —
 * the `tool_use` block and the matching `tool_result` message are stripped.
 *
 * Root cause hypothesis: `Orchestrator.projectRootThreadHistory()`
 * (`orchestrator.ts:519`) walks the persisted log to build the root agent's
 * `threadHistory` for a new turn, but only emits:
 *   - `user` messages (from the per-turn root toolCall invocation)
 *   - `assistant` messages with `stopReason === 'stop'`
 * Intermediate assistant messages with `stopReason: 'toolUse'` AND every
 * `toolResult` entry are dropped. So the model loses visibility into what it
 * did on prior turns.
 *
 * This test sets up a two-turn flow with a faux LLM, and on turn 2 captures
 * the `Context.messages` the model actually receives. We assert the turn-1
 * tool_use and tool_result are present. Today this FAILS (proving the bug).
 */
import type {
  AssistantMessage,
  Message,
  TextContent,
  ToolCall,
} from '@/orchestrator/llm';
import { fauxAssistantMessage, fauxToolCall } from '@/orchestrator/llm/testing';
import { Orchestrator } from '@/orchestrator/orchestrator';
import {
  BenchmarkAnalystAgent,
  fauxRegistration,
} from '@/agents/benchmark-analyst/benchmark-analyst';
import {
  BaseExecuteQuery,
  BaseSearchDBSchema,
  ListDBConnections,
} from '@/agents/benchmark-analyst/db-tools';
import type { BenchmarkAnalystContext } from '@/agents/benchmark-analyst/types';

// BaseExecuteQuery would normally spin up a real DuckDB connector — short-
// circuit it so we control what the "tool result" looks like.
vi.mock('@/lib/connections/run-query', () => ({
  runQuery: vi.fn(async (_db: string, query: string) => ({
    columns: ['x'],
    types: ['BIGINT'],
    rows: [[1]],
    finalQuery: query,
  })),
}));
vi.mock('@/lib/connections/load-schema', () => ({
  loadConnectionSchema: vi.fn(async () => []),
}));

const REGISTRABLES = [
  ListDBConnections,
  BaseSearchDBSchema,
  BaseExecuteQuery,
  BenchmarkAnalystAgent,
];

const CTX: BenchmarkAnalystContext = {
  connections: [
    {
      name: 'test_db',
      dialect: 'duckdb',
      description: 'test conn',
      config: { file_path: '/nonexistent/test.duckdb' },
    },
  ],
  contextDocs: '',
};

describe('AnalystAgent: prior-turn tool calls survive into the next turn\'s LLM context', () => {
  it('turn 2 prompt to the LLM includes turn 1\'s tool_use block and matching tool_result', async () => {
    // ---- Turn 1 -------------------------------------------------------------
    // The agent's first LLM call returns a single tool_use (ExecuteQuery).
    // After we execute the (mocked) tool, the second LLM call replies with
    // text and stopReason 'stop', ending the turn.
    fauxRegistration.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall(
            'ExecuteQuery',
            { sql: 'SELECT 1', connection_name: 'test_db' },
            { id: 'tc-execquery-1' },
          ),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Done! Query ran.', { stopReason: 'stop' }),
    ]);

    const orch1 = new Orchestrator(REGISTRABLES);
    const root1 = new BenchmarkAnalystAgent(
      orch1,
      { userMessage: 'run a query' },
      CTX,
    );
    const stream1 = orch1.run(root1);
    for await (const _ev of stream1) {
      /* drain */
    }
    await stream1.result();

    // Sanity: turn 1 produced the tool_use and a toolResult in the log.
    const log = orch1.log;
    const assistantMsgs = log.filter(
      (e) => 'role' in e && e.role === 'assistant',
    ) as AssistantMessage[];
    const turn1ToolUseInLog = assistantMsgs
      .flatMap((m) => m.content)
      .find((c) => c.type === 'toolCall' && (c as ToolCall).name === 'ExecuteQuery');
    expect(turn1ToolUseInLog).toBeDefined();
    const turn1ToolResultInLog = log.find(
      (e) =>
        'role' in e &&
        e.role === 'toolResult' &&
        (e as { toolCallId?: string }).toolCallId === 'tc-execquery-1',
    );
    expect(turn1ToolResultInLog).toBeDefined();

    // ---- Turn 2 -------------------------------------------------------------
    // Replay the saved log into a fresh Orchestrator (this is what chat does
    // between turns). Use a factory response so we can inspect the actual
    // Context.messages the model receives.
    let capturedMessages: Message[] | null = null;
    fauxRegistration.setResponses([
      (context) => {
        capturedMessages = context.messages;
        return fauxAssistantMessage('ack', { stopReason: 'stop' });
      },
    ]);

    const orch2 = new Orchestrator(REGISTRABLES, [...log]);
    const root2 = new BenchmarkAnalystAgent(
      orch2,
      { userMessage: 'what tool calls did you make?' },
      CTX,
    );
    const stream2 = orch2.run(root2);
    for await (const _ev of stream2) {
      /* drain */
    }
    await stream2.result();

    expect(capturedMessages).not.toBeNull();
    const messages = capturedMessages as unknown as Message[];

    // Debug-friendly snapshot if the assertions below fail.
    const compact = messages.map((m) => ({
      role: m.role,
      contentTypes:
        typeof (m as { content?: unknown }).content === 'string'
          ? ['text']
          : Array.isArray((m as { content?: unknown[] }).content)
            ? ((m as { content: Array<{ type: string }> }).content).map((c) => c.type)
            : [],
    }));

    // Assertion 1: at least one assistant message in turn 2's prompt carries
    // a toolCall block (the ExecuteQuery from turn 1).
    const allAssistantBlocks = messages
      .filter((m): m is AssistantMessage => m.role === 'assistant')
      .flatMap((m) => m.content);
    const toolUseBlocks = allAssistantBlocks.filter(
      (c) => c.type === 'toolCall',
    ) as ToolCall[];
    expect(
      toolUseBlocks,
      `expected the turn-1 ExecuteQuery tool_use to be visible to the model on turn 2.\n` +
        `Got messages: ${JSON.stringify(compact, null, 2)}`,
    ).toHaveLength(1);
    expect(toolUseBlocks[0].name).toBe('ExecuteQuery');
    expect(toolUseBlocks[0].id).toBe('tc-execquery-1');

    // Assertion 2: the matching tool_result is also in the prompt.
    const toolResults = messages.filter((m) => m.role === 'toolResult');
    expect(
      toolResults.some(
        (m) => (m as { toolCallId: string }).toolCallId === 'tc-execquery-1',
      ),
      `expected the turn-1 ExecuteQuery tool_result to be visible to the model on turn 2.\n` +
        `Got messages: ${JSON.stringify(compact, null, 2)}`,
    ).toBe(true);

    // Assertion 3: the turn-1 final text reply is also still there (this
    // already works today — included as a sanity check that we haven't
    // regressed the part that does work).
    const textReplies = messages
      .filter((m): m is AssistantMessage => m.role === 'assistant')
      .flatMap((m) => m.content)
      .filter((c): c is TextContent => c.type === 'text')
      .map((c) => c.text);
    expect(textReplies.join('\n')).toContain('Done!');
  });
});
