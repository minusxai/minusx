/**
 * Unit tests for slack/messages.ts parsing helpers.
 *
 * These tests verify extractSlackReplyFromLog against the three log formats
 * the Python backend can produce:
 *
 *   1. finish_reason='stop' → task_result.result = { success: true, content: "..." }
 *   2. Explicit TalkToUser tool call → completed_tool_calls[].content = { success: true, content: "...", citations: [] }
 *   3. Auto-dispatched TalkToUser (text alongside tool_calls) → completed_tool_calls[].content = { success: true, content_blocks: [{ type: 'text', text: '...' }] }
 */

import { extractSlackReplyFromLog } from '@/lib/integrations/slack/messages';
import type { ConversationLogEntry } from '@/lib/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function taskEntry(message: string): ConversationLogEntry {
  return {
    _type: 'task',
    args: { user_message: message },
  } as unknown as ConversationLogEntry;
}

function taskResultWithContent(content: string): ConversationLogEntry {
  return {
    _type: 'task_result',
    result: { success: true, content },
  } as unknown as ConversationLogEntry;
}

function taskResultWithTalkToUserContent(content: string): ConversationLogEntry {
  return {
    _type: 'task_result',
    result: {
      completed_tool_calls: [{
        function: { name: 'TalkToUser' },
        content: { success: true, content, citations: [] },
      }],
    },
  } as unknown as ConversationLogEntry;
}

function taskResultWithTalkToUserContentBlocks(text: string): ConversationLogEntry {
  return {
    _type: 'task_result',
    result: {
      completed_tool_calls: [{
        function: { name: 'TalkToUser' },
        content: {
          success: true,
          content_blocks: [{ type: 'text', text }],
        },
      }],
    },
  } as unknown as ConversationLogEntry;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('extractSlackReplyFromLog', () => {
  describe('finish_reason=stop path (direct result.content)', () => {
    it('extracts plain text from task_result.result.content', () => {
      const log = [
        taskEntry('What is revenue?'),
        taskResultWithContent('Revenue is up 12%.'),
      ];
      expect(extractSlackReplyFromLog(log)).toBe('Revenue is up 12%.');
    });

    it('strips <thinking> tags and returns only visible text', () => {
      const log = [
        taskEntry('Hello'),
        taskResultWithContent('<thinking>Let me think about this.</thinking>\nHello! How can I help?'),
      ];
      expect(extractSlackReplyFromLog(log)).toBe('Hello! How can I help?');
    });

    it('returns null when content is only thinking with no visible text', () => {
      const log = [
        taskEntry('Hello'),
        taskResultWithContent('<thinking>Just thinking, no reply.</thinking>'),
      ];
      expect(extractSlackReplyFromLog(log)).toBeNull();
    });

    it('uses the LAST task_result when multiple are present (follow-up messages)', () => {
      const log = [
        taskEntry('First question'),
        taskResultWithContent('First answer.'),
        taskEntry('Second question'),
        taskResultWithContent('Second answer.'),
      ];
      expect(extractSlackReplyFromLog(log)).toBe('Second answer.');
    });
  });

  describe('explicit TalkToUser tool call path (content field)', () => {
    it('extracts text from completed_tool_calls TalkToUser content field', () => {
      const log = [
        taskEntry('How did sales do?'),
        taskResultWithTalkToUserContent('Sales grew 15% last quarter.'),
      ];
      expect(extractSlackReplyFromLog(log)).toBe('Sales grew 15% last quarter.');
    });

    it('ignores non-TalkToUser tool calls and falls back to other entries', () => {
      const log = [
        taskEntry('Run a query'),
        {
          _type: 'task_result',
          result: {
            completed_tool_calls: [
              {
                function: { name: 'ExecuteQuery' },
                content: { success: true, content: 'some raw query result' },
              },
              {
                function: { name: 'TalkToUser' },
                content: { success: true, content: 'Here are the results.', citations: [] },
              },
            ],
          },
        } as unknown as ConversationLogEntry,
      ];
      expect(extractSlackReplyFromLog(log)).toBe('Here are the results.');
    });
  });

  describe('auto-dispatched TalkToUser path (content_blocks format)', () => {
    it('extracts text from content_blocks array', () => {
      const log = [
        taskEntry('Show me the data'),
        taskResultWithTalkToUserContentBlocks('Here is the analysis you requested.'),
      ];
      expect(extractSlackReplyFromLog(log)).toBe('Here is the analysis you requested.');
    });

    it('joins multiple text blocks with newlines', () => {
      const log = [
        taskEntry('Summary please'),
        {
          _type: 'task_result',
          result: {
            completed_tool_calls: [{
              function: { name: 'TalkToUser' },
              content: {
                success: true,
                content_blocks: [
                  { type: 'text', text: 'Line one.' },
                  { type: 'text', text: 'Line two.' },
                ],
              },
            }],
          },
        } as unknown as ConversationLogEntry,
      ];
      expect(extractSlackReplyFromLog(log)).toBe('Line one.\nLine two.');
    });

    it('skips non-text blocks (e.g. image blocks) and returns only text', () => {
      const log = [
        taskEntry('Show chart'),
        {
          _type: 'task_result',
          result: {
            completed_tool_calls: [{
              function: { name: 'TalkToUser' },
              content: {
                success: true,
                content_blocks: [
                  { type: 'image', url: 'https://example.com/chart.png' },
                  { type: 'text', text: 'Here is the chart data.' },
                ],
              },
            }],
          },
        } as unknown as ConversationLogEntry,
      ];
      expect(extractSlackReplyFromLog(log)).toBe('Here is the chart data.');
    });

    it('returns null when content_blocks contains only non-text entries', () => {
      const log = [
        taskEntry('Show something'),
        {
          _type: 'task_result',
          result: {
            completed_tool_calls: [{
              function: { name: 'TalkToUser' },
              content: {
                success: true,
                content_blocks: [
                  { type: 'image', url: 'https://example.com/img.png' },
                ],
              },
            }],
          },
        } as unknown as ConversationLogEntry,
      ];
      // content_blocks yields nothing, so falls through — result.content not present → null
      expect(extractSlackReplyFromLog(log)).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('returns null for an empty log', () => {
      expect(extractSlackReplyFromLog([])).toBeNull();
    });

    it('returns null when there are no task_result entries', () => {
      const log = [taskEntry('Hello')];
      expect(extractSlackReplyFromLog(log)).toBeNull();
    });

    it('returns null when task_result has no usable content', () => {
      const log = [
        taskEntry('Hi'),
        { _type: 'task_result', result: { completed_tool_calls: [] } } as unknown as ConversationLogEntry,
      ];
      expect(extractSlackReplyFromLog(log)).toBeNull();
    });

    it('AtlasAnalystAgent tool calls are also extracted', () => {
      const log = [
        taskEntry('Question'),
        {
          _type: 'task_result',
          result: {
            completed_tool_calls: [{
              function: { name: 'AtlasAnalystAgent' },
              content: { success: true, content: 'Agent response here.' },
            }],
          },
        } as unknown as ConversationLogEntry,
      ];
      expect(extractSlackReplyFromLog(log)).toBe('Agent response here.');
    });
  });
});
