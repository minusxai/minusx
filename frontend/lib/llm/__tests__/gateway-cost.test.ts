/**
 * Cost reporting for the MinusX gateway.
 *
 * pi-ai normally computes cost as `local_rate × wire_tokens` via
 * `calculateCost(model, usage)`. That cannot work for the gateway: it picks the
 * model server-side per request, so the client has no rate to multiply by —
 * `buildCustomModel` zeroes them — and every managed call would bill as $0,
 * silently, while every other test stayed green.
 *
 * The gateway therefore reports its own cost in the usage object (OpenRouter's
 * `usage.cost` convention, the established way to carry cost over an
 * OpenAI-compatible wire — the OpenAI usage object has no cost field). pi-ai is
 * patched to honour it (`patches/@earendil-works+pi-ai+0.80.6.patch`).
 *
 * These drive a REAL local HTTP server speaking the gateway's exact wire format
 * through the real `streamSimple`, so the patch is what is under test — not a
 * re-implementation of it.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildCustomModel, streamSimple, type Api, type Model } from '@/orchestrator/llm';

/** One SSE body in the shape LiteLLM emits, with a configurable usage object. */
function sseBody(usage: Record<string, unknown>): string {
  const base = { id: 'chatcmpl-t', object: 'chat.completion.chunk', created: 0, model: 'claude-haiku-4-5' };
  return [
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'pong' }, finish_reason: null }] })}`,
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}`,
    `data: ${JSON.stringify({ ...base, choices: [], usage })}`,
    'data: [DONE]',
    '',
  ].join('\n\n');
}

let server: Server;
let baseUrl: string;
let nextUsage: Record<string, unknown>;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(sseBody(nextUsage));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function gatewayModel(): Model<Api> {
  // Exactly what buildMinusxModel produces: an OpenAI-compatible custom
  // endpoint, and therefore zero local rates.
  return buildCustomModel({ baseUrl, id: 'minusx-auto', provider: 'minusx', name: 'MinusX' });
}

async function callAndGetUsage(usage: Record<string, unknown>) {
  nextUsage = usage;
  const message = await streamSimple(gatewayModel(), {
    messages: [{ role: 'user', content: 'ping', timestamp: Date.now() }],
  } as never, { apiKey: 'test-key' }).result();
  return message!.usage;
}

const TOKENS = { prompt_tokens: 10, completion_tokens: 7, total_tokens: 17 };

describe('gateway cost reporting', () => {
  it('local rates for a gateway model are zero — the reason this exists', () => {
    expect(gatewayModel().cost).toMatchObject({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it('honours a provider-reported usage.cost instead of the zero local estimate', async () => {
    const usage = await callAndGetUsage({ ...TOKENS, cost: 4.5e-5 });
    expect(usage.cost.total).toBe(4.5e-5);
  });

  it('bills zero without a reported cost — proving the wire value is what fixes it', async () => {
    const usage = await callAndGetUsage({ ...TOKENS });
    expect(usage.cost.total).toBe(0);
  });

  it('breaks the cost down when the gateway sends cost_details', async () => {
    const usage = await callAndGetUsage({
      ...TOKENS, cost: 3.5e-5, cost_details: { input: 1e-5, output: 2.5e-5 },
    });
    expect(usage.cost.input).toBe(1e-5);
    expect(usage.cost.output).toBe(2.5e-5);
    expect(usage.cost.total).toBe(3.5e-5);
  });

  it('still reports the total when only cost is sent, with no breakdown', async () => {
    const usage = await callAndGetUsage({ ...TOKENS, cost: 9e-6 });
    expect(usage.cost.total).toBe(9e-6);
    expect(usage.cost.input).toBe(0);
  });

  it('keeps token counts intact alongside the reported cost', async () => {
    const usage = await callAndGetUsage({ ...TOKENS, cost: 4.5e-5 });
    expect(usage.input).toBe(10);
    expect(usage.output).toBe(7);
  });

  it('ignores a malformed cost rather than corrupting the total', async () => {
    for (const bad of ['1.0', null, NaN, undefined]) {
      const usage = await callAndGetUsage({ ...TOKENS, cost: bad });
      expect(usage.cost.total).toBe(0);
    }
  });

  it('accepts a zero reported cost as a real value', async () => {
    // A genuinely free call must stay 0, not fall back to the local estimate.
    const usage = await callAndGetUsage({ ...TOKENS, cost: 0 });
    expect(usage.cost.total).toBe(0);
  });
});
