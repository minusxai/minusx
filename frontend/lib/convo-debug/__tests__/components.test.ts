import { describe, it, expect } from 'vitest';
import type { AssistantMessage, ToolResultMessage, UserMessage } from '@/orchestrator/llm';
import { splitUserContent, splitAssistantContent, toolResultComponents } from '@/lib/convo-debug/components';
import { estimateTextTokens, IMAGE_TOKEN_FALLBACK } from '@/lib/convo-debug/approx';

const assistantMeta = {
  api: 'anthropic-messages' as never,
  provider: 'anthropic',
  model: 'claude-test',
  usage: {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'toolUse' as const,
  timestamp: 1,
};

describe('splitUserContent', () => {
  it('splits app state, file markup, query data, attachments, and goal text', () => {
    const appState = '<AppState>{"type":"file","state":{}}</AppState>';
    const markup = '<file_markup file_id=12 type=question>SELECT 1</file_markup>';
    const queryData = '<query_data query_result_id=7>a,b\n1,2</query_data>';
    const attachment = '<Attachment [notes.txt]>some notes</Attachment>';
    const goal = 'show me revenue by month';
    const msg: UserMessage = {
      role: 'user',
      timestamp: 1,
      content: [
        { type: 'text', text: `${appState}\n${markup}\n${queryData}\n${attachment}\n${goal}` },
      ],
    };
    const comps = splitUserContent(msg.content);
    const byType = Object.fromEntries(comps.map((c) => [c.type, c]));

    expect(byType.AppStateText.tokens).toBe(estimateTextTokens('{"type":"file","state":{}}'));
    expect(byType.FileMarkup.tokens).toBe(estimateTextTokens('SELECT 1'));
    expect(byType.QueryData.tokens).toBe(estimateTextTokens('a,b\n1,2'));
    expect(byType.Other.tokens).toBe(estimateTextTokens('some notes'));
    expect(byType.UserText.tokens).toBe(estimateTextTokens(goal));
    // No image blocks → no image components.
    expect(byType.AppStateImage).toBeUndefined();
    expect(byType.UserImages).toBeUndefined();
  });

  it('classifies an image following the AppState block as AppStateImage, others as UserImages', () => {
    const content: UserMessage['content'] = [
      { type: 'text', text: '<AppState>{"a":1}</AppState>' },
      { type: 'image', url: 'https://example.com/screenshot.png' },
      { type: 'text', text: 'my goal' },
      { type: 'image', url: 'https://example.com/user-upload.png' },
    ];
    const comps = splitUserContent(content);
    const appStateImage = comps.find((c) => c.type === 'AppStateImage');
    const userImages = comps.find((c) => c.type === 'UserImages');
    expect(appStateImage?.imageCount).toBe(1);
    expect(appStateImage?.tokens).toBe(IMAGE_TOKEN_FALLBACK);
    expect(appStateImage?.imageTokens).toBe(IMAGE_TOKEN_FALLBACK);
    expect(userImages?.imageCount).toBe(1);
  });

  it('handles plain-string content as UserText', () => {
    const comps = splitUserContent('hello world');
    expect(comps).toHaveLength(1);
    expect(comps[0].type).toBe('UserText');
    expect(comps[0].tokens).toBe(estimateTextTokens('hello world'));
  });

  it('returns an empty list for empty content', () => {
    expect(splitUserContent([])).toEqual([]);
  });
});

describe('splitAssistantContent', () => {
  it('splits thinking, text, and one component per tool call (named)', () => {
    const msg: AssistantMessage = {
      role: 'assistant',
      ...assistantMeta,
      content: [
        { type: 'thinking', thinking: 'let me think about this' },
        { type: 'text', text: 'Here is the plan.' },
        { type: 'toolCall', id: 't1', name: 'SearchDBSchema', arguments: { query: 'revenue' } },
        { type: 'toolCall', id: 't2', name: 'ExecuteQuery', arguments: { sql: 'SELECT 1' } },
      ],
    };
    const comps = splitAssistantContent(msg);
    expect(comps.find((c) => c.type === 'Thinking')?.tokens).toBe(estimateTextTokens('let me think about this'));
    expect(comps.find((c) => c.type === 'Text')?.tokens).toBe(estimateTextTokens('Here is the plan.'));
    const toolCalls = comps.filter((c) => c.type === 'ToolCalls');
    expect(toolCalls.map((c) => c.toolName)).toEqual(['SearchDBSchema', 'ExecuteQuery']);
    for (const tc of toolCalls) expect(tc.tokens).toBeGreaterThan(0);
  });

  it('returns empty for an empty assistant message', () => {
    const msg: AssistantMessage = { role: 'assistant', ...assistantMeta, content: [] };
    expect(splitAssistantContent(msg)).toEqual([]);
  });
});

describe('toolResultComponents', () => {
  it('produces one component PER tool result, keeping each size separate', () => {
    const results: ToolResultMessage[] = [
      {
        role: 'toolResult', toolCallId: 't1', toolName: 'SearchDBSchema', isError: false, timestamp: 2,
        content: [{ type: 'text', text: 'x'.repeat(400) }],
      },
      {
        role: 'toolResult', toolCallId: 't2', toolName: 'SearchDBSchema', isError: false, timestamp: 3,
        content: [{ type: 'text', text: 'y'.repeat(40) }],
      },
      {
        role: 'toolResult', toolCallId: 't3', toolName: 'ExecuteQuery', isError: true, timestamp: 4,
        content: [{ type: 'text', text: 'error: bad sql' }, { type: 'image', url: 'https://example.com/chart.png' }],
      },
    ];
    const comps = toolResultComponents(results);
    expect(comps).toHaveLength(3);
    expect(comps.map((c) => c.toolName)).toEqual(['SearchDBSchema', 'SearchDBSchema', 'ExecuteQuery']);
    expect(comps[0].tokens).toBe(100);
    expect(comps[1].tokens).toBe(10);
    expect(comps[2].imageCount).toBe(1);
    expect(comps[2].tokens).toBe(estimateTextTokens('error: bad sql') + IMAGE_TOKEN_FALLBACK);
    expect(comps[2].imageTokens).toBe(IMAGE_TOKEN_FALLBACK);
  });
});
