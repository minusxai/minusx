// Shared one-shot LLM connectivity probe (lib/llm/llm-test.server.ts) — used
// by both POST /api/llm/test and the setup-cli (scripts/setup-cli/validate-llm.ts).
import { describe, it, expect, beforeEach } from 'vitest';
import { registerFauxProvider, fauxAssistantMessage } from '@/orchestrator/llm/testing';
import { runLlmProbe, testLlmEntry } from '../llm-test.server';

const faux = registerFauxProvider();

describe('runLlmProbe', () => {
  beforeEach(() => faux.setResponses([]));

  it('returns ok with latency and model id on a successful reply', async () => {
    faux.setResponses([fauxAssistantMessage('ok')]);
    const result = await runLlmProbe(faux.getModel(), {});
    expect(result.ok).toBe(true);
    expect(result.model).toBeTruthy();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns ok:false with the error message when the stream errors', async () => {
    faux.setResponses([fauxAssistantMessage('nope', { stopReason: 'error', errorMessage: 'invalid api key' })]);
    const result = await runLlmProbe(faux.getModel(), {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('invalid api key');
  });
});

describe('testLlmEntry', () => {
  it('surfaces config errors (unknown model) as ok:false, not a throw', async () => {
    const result = await testLlmEntry(
      { name: 'oa', provider: 'openai', apiKey: 'k' },
      { model: 'gpt-definitely-not-real' },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not in the model registry/);
  });

  it('surfaces a missing custom baseUrl as ok:false', async () => {
    const result = await testLlmEntry(
      { name: 'c', provider: 'custom', apiKey: 'k' },
      { model: 'llama3' },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
