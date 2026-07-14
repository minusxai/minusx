// Validates the OpenAI (Responses API) half of the pi web-search patch
// (patches/@earendil-works+pi-ai+0.80.6.patch):
//  - request: the hosted `{ type: 'web_search' }` tool is injected when
//    options.webSearch is set (and user_location when a city is given)
//  - response: url_citation annotations — both the streaming
//    `response.output_text.annotation.added` events AND the authoritative
//    annotations on the final `response.output_item.done` message — are mapped
//    to unified `web_search_result_location` text-block citations, deduped.
// Uses a stubbed global fetch returning recorded Responses SSE (the OpenAI SDK
// wraps it into the stream pi iterates).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { getModel, streamSimple } from '@/orchestrator/llm';

afterEach(() => vi.restoreAllMocks());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stubOpenAIFetch(events: object[]): { captured: () => any } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  const fetchMock = vi.fn(async (input: unknown, init?: { body?: unknown }) => {
    let bodyStr = init?.body;
    if (!bodyStr && input instanceof Request) bodyStr = await input.clone().text();
    if (typeof bodyStr === 'string') body = JSON.parse(bodyStr);
    return new Response(sseStream(events), {
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

// Recorded-shape Responses SSE: a web_search_call (the hosted tool runs), then a
// message whose text carries url_citation annotations — one delivered while
// streaming (nextjs.org) and one present ONLY on the final message
// (react.dev), to exercise both the streaming and final-merge citation paths.
const NEXTJS = { type: 'url_citation', url: 'https://nextjs.org', title: 'Next.js', start_index: 0, end_index: 10 };
const REACT = { type: 'url_citation', url: 'https://react.dev', title: 'React', start_index: 0, end_index: 7 };
const WEB_SEARCH_SSE = [
  { type: 'response.created', response: { id: 'resp_1' } },
  // hosted web_search tool call — these events are not block-producing; assert they don't break parsing
  { type: 'response.output_item.added', item: { type: 'web_search_call', id: 'ws_1', status: 'in_progress', action: { type: 'search', query: 'next.js 16' } } },
  { type: 'response.web_search_call.searching', item_id: 'ws_1' },
  { type: 'response.web_search_call.completed', item_id: 'ws_1' },
  { type: 'response.output_item.done', item: { type: 'web_search_call', id: 'ws_1', status: 'completed', action: { type: 'search', query: 'next.js 16' } } },
  // assistant message
  { type: 'response.output_item.added', item: { type: 'message', id: 'msg_1', content: [] } },
  { type: 'response.content_part.added', item_id: 'msg_1', part: { type: 'output_text', text: '', annotations: [] } },
  { type: 'response.output_text.delta', item_id: 'msg_1', delta: 'Next.js 16 is current.' },
  { type: 'response.output_text.annotation.added', item_id: 'msg_1', annotation: NEXTJS },
  { type: 'response.output_item.done', item: { type: 'message', id: 'msg_1', content: [{ type: 'output_text', text: 'Next.js 16 is current.', annotations: [NEXTJS, REACT] }] } },
  { type: 'response.completed', response: { id: 'resp_1', status: 'completed', usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } } },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run(options: any, events: object[] = WEB_SEARCH_SSE) {
  const stub = stubOpenAIFetch(events);
  const model = getModel('openai', 'gpt-5.4');
  const ctx = { systemPrompt: 's', messages: [{ role: 'user' as const, content: 'q', timestamp: 0 }], tools: [] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = streamSimple(model, ctx as any, { apiKey: 'sk-test', ...options });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let done: any;
  for await (const ev of stream) {
    if (ev.type === 'done') done = ev.message;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (ev.type === 'error') throw new Error('stream error: ' + JSON.stringify((ev as any).error?.errorMessage ?? ev));
  }
  return { done, captured: stub.captured };
}

describe('pi web-search patch (OpenAI Responses)', () => {
  it('maps url_citation annotations (streaming + final) to deduped text-block citations', async () => {
    const { done } = await run({ webSearch: true });
    const text = done.content.find((b: { type: string }) => b.type === 'text');
    expect(text.text).toBe('Next.js 16 is current.');
    // nextjs.org arrives via BOTH the streaming annotation.added and the final
    // message annotations → deduped to one; react.dev only on the final message.
    expect(text.citations).toHaveLength(2);
    expect(text.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'web_search_result_location', url: 'https://nextjs.org', cited_text: 'Next.js 16' }),
        expect.objectContaining({ type: 'web_search_result_location', url: 'https://react.dev', cited_text: 'Next.js' }),
      ]),
    );
  });

  it('injects the hosted web_search tool when webSearch is set', async () => {
    const { captured } = await run({ webSearch: true });
    const tools = captured().tools ?? [];
    expect(tools).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'web_search' })]));
  });

  it('adds approximate user_location when a city is given', async () => {
    const { captured } = await run({ webSearch: { userLocation: { city: 'Berlin' } } });
    const ws = (captured().tools ?? []).find((t: { type?: string }) => t.type === 'web_search');
    expect(ws).toMatchObject({ type: 'web_search', user_location: { type: 'approximate', city: 'Berlin' } });
  });

  it('does NOT inject the web_search tool when webSearch is absent', async () => {
    const { captured } = await run({});
    const hasWebSearch = (captured().tools ?? []).some((t: { type?: string }) => t.type === 'web_search');
    expect(hasWebSearch).toBe(false);
  });
});
