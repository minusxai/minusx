import { describe, expect, it } from 'vitest';
import { estimateContextSize, cachedTokensPerSection } from '@/lib/chat/context-size-estimate';
import type { ContextSizeSection } from '@/lib/chat/context-size-estimate';
import type { Api, Context } from '@/orchestrator/llm';
import type { TSchema } from 'typebox';

describe('cachedTokensPerSection', () => {
  // The provider's prompt cache covers a contiguous PREFIX of the WIRE serialization: system prompt,
  // tool defs, then PRIOR-turn messages (conversation/tool-call history). The CURRENT turn's new
  // content (app state, file markup, attachments, the next user message) is fresh — NOT in that
  // prefix — so it must never show as cached, however large `cachedTokens` (usage.cacheRead) is.
  // The cached prefix is distributed across the cacheable sections in wire order.
  const sections = (): ContextSizeSection[] => [
    { key: 'system_prompt', label: 'System prompt', tokens: 7000, chars: 0 },
    { key: 'tool_definitions', label: 'Tool definitions', tokens: 3000, chars: 0 },
    { key: 'conversation_history', label: 'Conv history', tokens: 800, chars: 0 },
    { key: 'app_state', label: 'App state', tokens: 500, chars: 0 },          // fresh (current turn)
    { key: 'file_markup', label: 'File markup', tokens: 400, chars: 0 },      // fresh (current turn)
    { key: 'next_user_message', label: 'Next user msg', tokens: 100, chars: 0 }, // fresh (not on wire yet)
  ];

  it('returns 0 for every section when nothing is cached', () => {
    expect(cachedTokensPerSection(sections(), 0)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('fills the cacheable wire prefix (system → tools → history) in order', () => {
    // 10,800 = system(7000)+tools(3000)+conv(800); fresh sections stay 0.
    expect(cachedTokensPerSection(sections(), 10_800)).toEqual([7000, 3000, 800, 0, 0, 0]);
  });

  it('splits at a boundary inside a cacheable section', () => {
    // 8,000 cached → all system (7000) + 1000 of tools; conv + fresh = 0.
    expect(cachedTokensPerSection(sections(), 8_000)).toEqual([7000, 1000, 0, 0, 0, 0]);
  });

  it('NEVER attributes cache to fresh current-turn sections, even when the prefix is huge', () => {
    // The bug: next_user_message / app_state / file_markup showing as cached. They are fresh.
    expect(cachedTokensPerSection(sections(), 1_000_000)).toEqual([7000, 3000, 800, 0, 0, 0]);
  });

  it('treats missing/zero cachedTokens as all-uncached', () => {
    expect(cachedTokensPerSection(sections(), undefined)).toEqual([0, 0, 0, 0, 0, 0]);
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

  it('counts each image in the current user turn under image_attachments (~1k tokens each)', () => {
    // The current page's screenshot is attached to the app-state image facet and rendered into the
    // CURRENT user message as an ImageContent block (see lib/projection). This is what the
    // /view-context-size panel must surface — a renderable file page carries one screenshot, so the
    // estimate must report ~1k image tokens (not 0).
    const withImage = (n: number): Context => ({
      systemPrompt: 's',
      tools: [],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '<AppState>{"id":1}</AppState>' },
            ...Array.from({ length: n }, () => ({ type: 'image' as const, data: 'abc', mimeType: 'image/png' })),
            { type: 'text', text: 'go' },
          ],
          timestamp: 1,
        },
      ],
    });

    const img1 = estimateContextSize(withImage(1)).sections.find((s) => s.key === 'image_attachments');
    expect(img1?.tokens).toBe(1000);

    const img2 = estimateContextSize(withImage(2)).sections.find((s) => s.key === 'image_attachments');
    expect(img2?.tokens).toBe(2000);

    // No image (e.g. a non-file page, or an unchanged view deduped by the projection) → 0 tokens.
    const img0 = estimateContextSize({
      systemPrompt: 's', tools: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }], timestamp: 1 }],
    }).sections.find((s) => s.key === 'image_attachments');
    expect(img0?.tokens).toBe(0);
  });
});
