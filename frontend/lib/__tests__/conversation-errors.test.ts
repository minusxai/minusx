/**
 * Cycle 6: `parseLogToMessages` interleaves the `errors[]` array (written by
 * cycles 1-5) as `role:'error'` ErrorMessage rows in the chat message list,
 * so the chat UI renders them distinctly (similar to debug messages).
 */
import { parseLogToMessages } from '@/lib/conversations-utils';
import type { ConversationLogEntry, ErrorLogEntry } from '@/lib/types';

describe('parseLogToMessages — errors[] merged into messages as ErrorMessage rows', () => {
  it('Cycle 6: errors[] entries appear as role:"error" messages with source / message / details / timestamp', () => {
    const log: ConversationLogEntry[] = [
      {
        _type: 'task',
        agent: 'AnalystAgent',
        args: { user_message: 'do the thing' },
        unique_id: 't1',
        created_at: '2024-01-01T00:00:00Z',
        _run_id: 'r1',
      } as unknown as ConversationLogEntry,
    ];
    const errors: ErrorLogEntry[] = [
      {
        _type: 'error',
        source: 'llm',
        message: 'provider 5xx after retries',
        timestamp: Date.parse('2024-01-01T00:00:05Z'),
      },
      {
        _type: 'error',
        source: 'frontend-tool',
        message: 'String "x" not found in file',
        timestamp: Date.parse('2024-01-01T00:00:10Z'),
        details: { tool_name: 'EditFile', tool_call_id: 'tc_edit_001' },
      },
    ];

    const messages = parseLogToMessages(log, errors);
    const errorRows = messages.filter((m: { role?: string }) => m?.role === 'error');

    expect(errorRows).toHaveLength(2);
    expect(errorRows[0]).toMatchObject({
      role: 'error',
      source: 'llm',
      content: 'provider 5xx after retries',
    });
    expect(typeof errorRows[0].created_at).toBe('string');
    expect(errorRows[1]).toMatchObject({
      role: 'error',
      source: 'frontend-tool',
      content: 'String "x" not found in file',
    });
    expect(errorRows[1].details).toMatchObject({ tool_name: 'EditFile', tool_call_id: 'tc_edit_001' });
  });

  it('Cycle 6: omits the errors merge when called without a second argument (backward-compat)', () => {
    const log: ConversationLogEntry[] = [];
    const messages = parseLogToMessages(log);
    expect(messages.filter((m: { role?: string }) => m?.role === 'error')).toHaveLength(0);
  });
});
