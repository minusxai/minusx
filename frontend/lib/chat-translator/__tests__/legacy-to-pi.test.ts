// legacyLogToPi: reverse translator that seeds a v2 (pi) conversation log from a
// v1 (legacy) log, so an old chat can be forked to v2 and continued.
//
// Faithful: user turns → root invocation; TalkToUser → assistant text (+
// citations / web_search_tool_result); tool tasks → assistant tool_use + paired
// tool_result (DISPLAY only — projectRootThreadHistory never sends them to the
// LLM). Thinking blocks are kept WITHOUT signatures (re-sending a v1 signature
// in a v2 native call would be rejected).

import { describe, it, expect } from 'vitest';
import { legacyLogToPi, piLogToLegacy } from '@/lib/chat-translator';
import type { ConversationLogEntry } from '@/lib/types';

const TS = '2026-01-01T00:00:00.000Z';

function userTask(id: string, msg: string): ConversationLogEntry {
  return { _type: 'task', _run_id: `run-${id}`, agent: 'AnalystAgent', args: { user_message: msg }, unique_id: id, created_at: TS };
}
function toolTask(id: string, parent: string, agent: string, args: Record<string, unknown>): ConversationLogEntry {
  return { _type: 'task', _run_id: `run-${id}`, _parent_unique_id: parent, agent, args, unique_id: id, created_at: TS };
}
function taskResult(taskId: string, result: string, details?: Record<string, unknown>): ConversationLogEntry {
  return { _type: 'task_result', _task_unique_id: taskId, result, details: details as never, created_at: TS };
}
function talkToUser(id: string, parent: string, contentBlocks: unknown[]): ConversationLogEntry {
  return { _type: 'task', _run_id: `run-${id}`, _parent_unique_id: parent, agent: 'TalkToUser', args: { content_blocks: contentBlocks }, unique_id: id, created_at: TS };
}

describe('legacyLogToPi', () => {
  it('converts a user turn + tool call/result + final answer into a valid pi log', () => {
    const legacy: ConversationLogEntry[] = [
      userTask('r1', 'how many users?'),
      toolTask('t1', 'r1', 'ExecuteQuery', { query: 'SELECT count(*)' }),
      taskResult('t1', '{"rows":[{"c":5}]}', { success: true }),
      talkToUser('ttu1', 'r1', [{ type: 'text', text: 'There are 5 users.' }]),
      taskResult('ttu1', '{"success":true,"content_blocks":[{"type":"text","text":"There are 5 users."}]}'),
    ];
    const pi = legacyLogToPi(legacy);

    // root invocation
    const root = pi[0] as unknown as { type: string; id: string; arguments: { userMessage: string }; parent_id: null };
    expect(root.type).toBe('toolCall');
    expect(root.id).toBe('r1');
    expect(root.parent_id).toBeNull();
    expect(root.arguments.userMessage).toBe('how many users?');

    // tool: assistant(toolCall) + paired toolResult, both children of r1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asstTool = pi.find((e: any) => e.role === 'assistant' && e.content?.[0]?.type === 'toolCall') as any;
    expect(asstTool.content[0]).toMatchObject({ type: 'toolCall', id: 't1', name: 'ExecuteQuery', arguments: { query: 'SELECT count(*)' } });
    expect(asstTool.parent_id).toBe('r1');
    expect(asstTool.stopReason).toBe('toolUse'); // not 'stop' → excluded from LLM history
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolRes = pi.find((e: any) => e.role === 'toolResult') as any;
    expect(toolRes).toMatchObject({ toolCallId: 't1', toolName: 'ExecuteQuery', isError: false, parent_id: 'r1' });
    expect(toolRes.content[0].text).toBe('{"rows":[{"c":5}]}');

    // final answer: assistant text, stopReason 'stop'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asstText = pi.find((e: any) => e.role === 'assistant' && e.content?.some((c: any) => c.type === 'text')) as any;
    expect(asstText.content.find((c: { type: string }) => c.type === 'text').text).toBe('There are 5 users.');
    expect(asstText.stopReason).toBe('stop');
    expect(asstText.parent_id).toBe('r1');
  });

  it('keeps thinking text but DROPS the signature', () => {
    const legacy: ConversationLogEntry[] = [
      userTask('r1', 'q'),
      talkToUser('ttu1', 'r1', [
        { type: 'thinking', thinking: 'let me reason', signature: 'SIG_v1_abc' },
        { type: 'text', text: 'answer' },
      ]),
      taskResult('ttu1', '{"success":true}'),
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asst = legacyLogToPi(legacy).find((e: any) => e.role === 'assistant') as any;
    const thinking = asst.content.find((c: { type: string }) => c.type === 'thinking');
    expect(thinking.thinking).toBe('let me reason');
    expect(thinking.thinkingSignature).toBeUndefined();
    expect(thinking.signature).toBeUndefined();
  });

  it('preserves web-search citations + web_search_tool_result blocks', () => {
    const citation = { type: 'web_search_result_location', url: 'https://ex.com', cited_text: 'fact' };
    const wsr = { type: 'web_search_tool_result', tool_use_id: 'srv1', content: [{ type: 'web_search_result', url: 'https://ex.com' }] };
    const legacy: ConversationLogEntry[] = [
      userTask('r1', 'q'),
      talkToUser('ttu1', 'r1', [wsr, { type: 'text', text: 'answer', citations: [citation] }]),
      taskResult('ttu1', '{"success":true}'),
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asst = legacyLogToPi(legacy).find((e: any) => e.role === 'assistant') as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = asst.content.find((c: any) => c.type === 'text');
    expect(text.citations).toEqual([citation]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(asst.content.find((c: any) => c.type === 'web_search_tool_result')).toMatchObject({ tool_use_id: 'srv1' });
  });

  it('round-trips through piLogToLegacy (display equivalence) and yields correct LLM history shape', () => {
    const legacy: ConversationLogEntry[] = [
      userTask('r1', 'first?'),
      toolTask('t1', 'r1', 'ExecuteQuery', { query: 'q1' }),
      taskResult('t1', 'result-1', { success: true }),
      talkToUser('ttu1', 'r1', [{ type: 'text', text: 'answer one' }]),
      taskResult('ttu1', '{"success":true,"content_blocks":[{"type":"text","text":"answer one"}]}'),
      userTask('r2', 'second?'),
      talkToUser('ttu2', 'r2', [{ type: 'text', text: 'answer two' }]),
      taskResult('ttu2', '{"success":true,"content_blocks":[{"type":"text","text":"answer two"}]}'),
    ];
    const pi = legacyLogToPi(legacy);
    const back = piLogToLegacy(pi);

    // Display round-trip: tasks (agent + key content) survive, ignoring debug/timestamps.
    const userMsgs = back.filter((e) => e._type === 'task' && e.agent === 'AnalystAgent').map((e) => (e as { args: { user_message: string } }).args.user_message);
    expect(userMsgs).toEqual(['first?', 'second?']);
    const toolAgents = back.filter((e) => e._type === 'task' && e.agent === 'ExecuteQuery');
    expect(toolAgents).toHaveLength(1);
    const ttuTexts = back
      .filter((e): e is Extract<ConversationLogEntry, { _type: 'task' }> => e._type === 'task' && e.agent === 'TalkToUser')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((e) => (e.args as any).content_blocks?.[0]?.text);
    expect(ttuTexts).toEqual(['answer one', 'answer two']);
  });
});
