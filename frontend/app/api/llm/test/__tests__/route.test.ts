// POST /api/llm/test — one-shot connectivity test for an LLM provider entry.
// Admin-only. Accepts a raw key, a @SECRETS/… ref, or the redacted placeholder
// (= test the SAVED key); the key never round-trips back to the client.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { saveRawConfig, getRawConfig } from '@/lib/data/configs.server';
import { REDACTED_SECRET } from '@/lib/secrets/config-secret-specs';
import * as llm from '@/orchestrator/llm';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn((fn: unknown) => fn),
}));

import { POST } from '../../test/route';

const dbPath = getTestDbPath('llm_test_route');
beforeAll(async () => { await initTestDatabase(dbPath); });
afterAll(async () => { await cleanupTestDatabase(dbPath); });

function post(body: object) {
  return POST(new NextRequest('http://localhost:3000/api/llm/test', {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  }));
}

/** Stub streamSimple; capture options; yield one done message. */
function stubLlm(text = 'ok') {
  const calls: Array<{ model: unknown; options?: Record<string, unknown> }> = [];
  vi.spyOn(llm, 'streamSimple').mockImplementation(((model: unknown, _ctx: unknown, options?: Record<string, unknown>) => {
    calls.push({ model, options });
    return (async function* () {
      yield { type: 'done', message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' } };
    })();
  }) as never);
  return calls;
}

describe('POST /api/llm/test', () => {
  it('tests a provider entry with a raw key and reports ok + latency', async () => {
    const calls = stubLlm();
    const res = await post({
      provider: { name: 'try-anthropic', provider: 'anthropic', apiKey: 'sk-ant-candidate' },
      model: 'claude-sonnet-4-6',
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.ok).toBe(true);
    expect(typeof body.data.latencyMs).toBe('number');
    expect(calls[0].options?.apiKey).toBe('sk-ant-candidate');
    // The raw key never appears in the response.
    expect(JSON.stringify(body)).not.toContain('sk-ant-candidate');
  });

  it('a redacted placeholder key tests the SAVED key for that provider name', async () => {
    // Save a provider (extracts the key to the secrets store)…
    const raw = await getRawConfig('org');
    await saveRawConfig('org', {
      ...raw,
      llm: { providers: [{ name: 'saved-prov', provider: 'anthropic', apiKey: 'sk-ant-saved-key' }] },
    } as never);

    const calls = stubLlm();
    const res = await post({
      provider: { name: 'saved-prov', provider: 'anthropic', apiKey: REDACTED_SECRET },
      model: 'claude-sonnet-4-6',
    });
    const body = await res.json();
    expect(body.data.ok).toBe(true);
    expect(calls[0].options?.apiKey).toBe('sk-ant-saved-key');   // resolved from the store
  });

  it('reports ok:false with the provider error when the call fails', async () => {
    vi.spyOn(llm, 'streamSimple').mockImplementation((() => (async function* () {
      yield { type: 'error', error: { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'invalid x-api-key' } };
    })()) as never);
    const res = await post({
      provider: { name: 'bad', provider: 'anthropic', apiKey: 'sk-wrong' },
      model: 'claude-sonnet-4-6',
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.ok).toBe(false);
    expect(body.data.error).toMatch(/invalid x-api-key/);
  });

  it('rejects an invalid body', async () => {
    const res = await post({ provider: { name: '' } });
    expect(res.status).toBe(400);
  });

  it('rejects a config error (unknown registry model) as ok:false, not a 500', async () => {
    stubLlm();
    const res = await post({
      provider: { name: 'a', provider: 'anthropic', apiKey: 'k' },
      model: 'no-such-model',
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.ok).toBe(false);
    expect(body.data.error).toMatch(/not in the model registry/);
  });
});
