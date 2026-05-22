// Validates the pi web-search patch (patches/@mariozechner+pi-ai+0.73.0.patch):
//  - request: the web_search server tool is injected when options.webSearch is set
//  - response: web_search_tool_result blocks + text-block citations are parsed,
//    and server_tool_use is dropped (matching Python)
//  - image: an ImageContent with `url` serializes to an Anthropic url source
// Uses an injected fake Anthropic client (options.client) returning recorded SSE
// — the exact shapes captured from the real API in the spike.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { getModel, streamSimple } from '@/orchestrator/llm';

afterEach(() => vi.restoreAllMocks());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stubAnthropicFetch(): { captured: () => any } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  const fetchMock = vi.fn(async (input: unknown, init?: { body?: unknown }) => {
    let bodyStr = init?.body;
    if (!bodyStr && input instanceof Request) bodyStr = await input.clone().text();
    if (typeof bodyStr === 'string') body = JSON.parse(bodyStr);
    return new Response(sseStream(WEB_SEARCH_SSE), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { captured: () => body };
}

function sseStream(events: object[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const e of events) {
        c.enqueue(enc.encode(`event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`));
      }
      c.close();
    },
  });
}

const WEB_SEARCH_SSE = [
  { type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 10, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"x"}' } },
  { type: 'content_block_stop', index: 0 },
  {
    type: 'content_block_start',
    index: 1,
    content_block: {
      type: 'web_search_tool_result',
      tool_use_id: 'srvtoolu_1',
      content: [{ type: 'web_search_result', url: 'https://nextjs.org', title: 'Next.js', encrypted_content: 'enc' }],
    },
  },
  { type: 'content_block_stop', index: 1 },
  { type: 'content_block_start', index: 2, content_block: { type: 'text', text: '', citations: [] } },
  { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Next.js 16 is current.' } },
  {
    type: 'content_block_delta',
    index: 2,
    delta: {
      type: 'citations_delta',
      citation: { type: 'web_search_result_location', url: 'https://nextjs.org', title: 'Next.js', cited_text: 'Next.js 16', encrypted_index: 'idx' },
    },
  },
  { type: 'content_block_stop', index: 2 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } },
  { type: 'message_stop' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run(options: any, content: unknown = 'q') {
  const model = getModel('anthropic', 'claude-haiku-4-5');
  const ctx = { systemPrompt: 's', messages: [{ role: 'user' as const, content, timestamp: 0 }], tools: [] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = streamSimple(model, ctx as any, { apiKey: 'sk-test', ...options });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let done: any;
  for await (const ev of stream) {
    if (ev.type === 'done') done = ev.message;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (ev.type === 'error') throw new Error('stream error: ' + JSON.stringify((ev as any).error?.errorMessage ?? ev));
  }
  return done;
}

describe('pi web-search patch', () => {
  it('parses web_search_tool_result + text citations, and keeps server_tool_use (with its query) for resend', async () => {
    stubAnthropicFetch();
    const done = await run({ webSearch: true });
    const types = done.content.map((b: { type: string }) => b.type);
    expect(types).toContain('text');
    expect(types).toContain('web_search_tool_result');
    // server_tool_use is kept (needed to re-send the pairing on multi-turn) but
    // hidden from the UI by the chat-translator.
    expect(types).toContain('server_tool_use');

    const stu = done.content.find((b: { type: string }) => b.type === 'server_tool_use');
    expect(stu).toMatchObject({ name: 'web_search', input: { query: 'x' } });

    const text = done.content.find((b: { type: string }) => b.type === 'text');
    expect(text.text).toBe('Next.js 16 is current.');
    expect(text.citations).toHaveLength(1);
    expect(text.citations[0]).toMatchObject({ type: 'web_search_result_location', url: 'https://nextjs.org', cited_text: 'Next.js 16' });

    const wsr = done.content.find((b: { type: string }) => b.type === 'web_search_tool_result');
    expect(wsr.content[0]).toMatchObject({ type: 'web_search_result', url: 'https://nextjs.org' });
  });

  it('re-serializes the server_tool_use + web_search_tool_result pairing on multi-turn resend', async () => {
    const stub = stubAnthropicFetch();
    const model = getModel('anthropic', 'claude-haiku-4-5');
    const priorAssistant = {
      role: 'assistant',
      content: [
        { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'next.js' } },
        { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: 'https://nextjs.org', title: 'Next.js', encrypted_content: 'enc' }] },
        { type: 'text', text: 'Prior answer', citations: [{ type: 'web_search_result_location', url: 'https://nextjs.org' }] },
      ],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop',
      timestamp: 0,
    };
    const ctx = {
      systemPrompt: 's',
      messages: [
        { role: 'user' as const, content: 'q1', timestamp: 0 },
        priorAssistant,
        { role: 'user' as const, content: 'q2', timestamp: 0 },
      ],
      tools: [],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = streamSimple(model, ctx as any, { apiKey: 'sk-test' } as any);
    for await (const _ of stream) { /* drain */ }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sentAssistant = stub.captured().messages.find((m: any) => m.role === 'assistant');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sentTypes = sentAssistant.content.map((b: any) => b.type);
    expect(sentTypes).toContain('server_tool_use');
    expect(sentTypes).toContain('web_search_tool_result');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stu = sentAssistant.content.find((b: any) => b.type === 'server_tool_use');
    expect(stu).toMatchObject({ id: 'srvtoolu_1', name: 'web_search' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wsr = sentAssistant.content.find((b: any) => b.type === 'web_search_tool_result');
    expect(wsr.content[0].url).toBe('https://nextjs.org');
  });

  it('injects the web_search server tool into the request when webSearch is set', async () => {
    const stub = stubAnthropicFetch();
    await run({ webSearch: { maxUses: 4, userLocation: { city: 'Berlin' } } });
    const tool = stub.captured().tools.find((t: { name?: string }) => t.name === 'web_search');
    expect(tool).toMatchObject({ type: 'web_search_20250305', name: 'web_search', max_uses: 4 });
    expect(tool.user_location).toMatchObject({ type: 'approximate', city: 'Berlin' });
  });

  it('does NOT inject the web_search tool when webSearch is absent', async () => {
    const stub = stubAnthropicFetch();
    await run({});
    const hasWebSearch = (stub.captured().tools ?? []).some((t: { name?: string }) => t.name === 'web_search');
    expect(hasWebSearch).toBe(false);
  });

  it('serializes an image with a url to an Anthropic url source', async () => {
    const stub = stubAnthropicFetch();
    await run({}, [
      { type: 'text', text: 'see' },
      { type: 'image', url: 'https://store.example.com/c.png' },
    ]);
    const userMsg = stub.captured().messages.find((m: { role: string }) => m.role === 'user');
    const imageBlock = userMsg.content.find((b: { type: string }) => b.type === 'image');
    expect(imageBlock.source).toMatchObject({ type: 'url', url: 'https://store.example.com/c.png' });
  });
});
