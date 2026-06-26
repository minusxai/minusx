import { describe, expect, it } from 'vitest';
import { estimateContextSize, cachedTokensPerSection } from '@/lib/chat/context-size-estimate';
import type { ContextSizeSection } from '@/lib/chat/context-size-estimate';
import type { Api, Context } from '@/orchestrator/llm';
import type { TSchema } from 'typebox';

describe('cachedTokensPerSection', () => {
  // The provider caches a contiguous PREFIX of the context. `cachedTokens` is the length of that
  // prefix (usage.cacheRead). Each section, in prefix order, gets the portion of itself that falls
  // within the first `cachedTokens` tokens.
  const sections = (): ContextSizeSection[] => [
    { key: 'a', label: 'A', tokens: 100, chars: 0 },
    { key: 'b', label: 'B', tokens: 200, chars: 0 },
    { key: 'c', label: 'C', tokens: 300, chars: 0 },
  ];

  it('returns 0 for every section when nothing is cached', () => {
    expect(cachedTokensPerSection(sections(), 0)).toEqual([0, 0, 0]);
  });

  it('splits a partial prefix across sections (boundary inside the second section)', () => {
    // 150 cached: all of A (100) + 50 of B + 0 of C
    expect(cachedTokensPerSection(sections(), 150)).toEqual([100, 50, 0]);
  });

  it('fills earlier sections fully before later ones', () => {
    expect(cachedTokensPerSection(sections(), 300)).toEqual([100, 200, 0]);
    expect(cachedTokensPerSection(sections(), 350)).toEqual([100, 200, 50]);
  });

  it('caps each section at its own size when the cached prefix exceeds the total', () => {
    expect(cachedTokensPerSection(sections(), 100000)).toEqual([100, 200, 300]);
  });

  it('treats missing/zero cachedTokens as all-uncached', () => {
    expect(cachedTokensPerSection(sections(), undefined)).toEqual([0, 0, 0]);
  });
});

describe('estimateContextSize', () => {
  it('splits the next user message into app state, attachments, wrapper, and goal sections', () => {
    const context: Context = {
      systemPrompt: 'system prompt',
      tools: [{ name: 'ToolA', description: 'tool description', parameters: { type: 'object' } as unknown as TSchema }],
      messages: [
        { role: 'user', content: 'previous question', timestamp: 1 },
        { role: 'assistant', content: [{ type: 'toolCall', id: 'tc1', name: 'ToolA', arguments: { a: 1 } }], api: 'x' as unknown as Api, provider: 'p', model: 'm', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'toolUse', timestamp: 2 },
        { role: 'toolResult', toolCallId: 'tc1', toolName: 'ToolA', content: [{ type: 'text', text: 'tool result' }], isError: false, timestamp: 3 },
        {
          role: 'user',
          content: [
            { type: 'text', text: '<AppState>{"id":1}</AppState>\n<CurrentDate>2026-06-24</CurrentDate>\n<Attachment [notes]>\nhello\n</Attachment>' },
            { type: 'image', data: 'abc', mimeType: 'image/png' },
            { type: 'text', text: 'next question' },
          ],
          timestamp: 4,
        },
      ],
    };

    const estimate = estimateContextSize(context);
    const keys = new Set(estimate.sections.map((section) => section.key));

    expect(estimate.totalTokens).toBeGreaterThan(0);
    expect(keys).toContain('system_prompt');
    expect(keys).toContain('tool_definitions');
    expect(keys).toContain('conversation_history');
    expect(keys).toContain('tool_call_history');
    expect(keys).toContain('app_state');
    expect(keys).toContain('text_attachments');
    expect(keys).toContain('image_attachments');
    expect(keys).toContain('next_user_message');
  });
});
