// Prompt caching default: every LLM call gets `cacheRetention` so the provider keeps the prompt
// prefix warm across turns (OpenAI → 24h `prompt_cache_retention`; Anthropic → 1h ttl). We default
// this to 'long' in code (overridable per-deployment via DEFAULT_CACHE_RETENTION, and per-agent via
// callOptions). These tests pin BOTH the pure env resolver and the actual wiring into streamSimple.
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as llm from '@/orchestrator/llm';
import { Orchestrator, resolveDefaultCacheRetention } from '../orchestrator';

describe('resolveDefaultCacheRetention', () => {
  it("defaults to 'long' when unset", () => {
    expect(resolveDefaultCacheRetention(undefined)).toBe('long');
  });
  it('passes through the three valid values', () => {
    expect(resolveDefaultCacheRetention('short')).toBe('short');
    expect(resolveDefaultCacheRetention('long')).toBe('long');
    expect(resolveDefaultCacheRetention('none')).toBe('none');
  });
  it("falls back to 'long' for any unrecognized value", () => {
    expect(resolveDefaultCacheRetention('forever')).toBe('long');
    expect(resolveDefaultCacheRetention('')).toBe('long');
  });
});

describe('Orchestrator.callLLM — cacheRetention wiring', () => {
  afterEach(() => vi.restoreAllMocks());

  function stubStream() {
    const captured: Array<Record<string, unknown> | undefined> = [];
    vi.spyOn(llm, 'streamSimple').mockImplementation(((_model: unknown, _ctx: unknown, options?: Record<string, unknown>) => {
      captured.push(options);
      return (async function* () {
        yield { type: 'done', message: { role: 'assistant', content: [], stopReason: 'stop' } };
      })();
    }) as never);
    return captured;
  }

  it("passes the default cacheRetention ('long') into streamSimple", async () => {
    const captured = stubStream();
    const orch = new Orchestrator([]);
    await orch.callLLM({} as never, {} as never, 'agent-1');
    expect(captured[0]?.cacheRetention).toBe('long');
  });

  it('lets an explicit callOptions.cacheRetention override the default', async () => {
    const captured = stubStream();
    const orch = new Orchestrator([]);
    await orch.callLLM({} as never, {} as never, 'agent-1', { cacheRetention: 'none' });
    expect(captured[0]?.cacheRetention).toBe('none');
  });
});
