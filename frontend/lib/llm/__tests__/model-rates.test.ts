import { describe, it, expect } from 'vitest';
import { parseModelsDevCatalog, getModelRatesFromCatalog } from '@/lib/llm/model-catalog.server';

const CATALOG_JSON = {
  anthropic: {
    models: {
      'claude-test': {
        name: 'Claude Test',
        tool_call: true,
        limit: { context: 200000, output: 8192 },
        cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
      },
      'claude-no-cost': {
        name: 'No Cost',
        tool_call: true,
      },
    },
  },
  openai: {
    models: {
      'gpt-test': {
        name: 'GPT Test',
        tool_call: true,
        cost: { input: 2, output: 8 },
      },
    },
  },
};

describe('getModelRatesFromCatalog', () => {
  const catalog = parseModelsDevCatalog(CATALOG_JSON);

  it('converts per-Mtok catalog pricing to $/token rates, searching all providers', () => {
    const rates = getModelRatesFromCatalog(['claude-test', 'gpt-test'], catalog);
    expect(rates['claude-test']).toEqual({ input: 3e-6, output: 15e-6, cacheRead: 0.3e-6, cacheWrite: 3.75e-6 });
    expect(rates['gpt-test']).toEqual({ input: 2e-6, output: 8e-6, cacheRead: 0, cacheWrite: 0 });
  });

  it('maps unknown or cost-less models to null', () => {
    const rates = getModelRatesFromCatalog(['claude-no-cost', 'never-heard-of-it'], catalog);
    expect(rates['claude-no-cost']).toBeNull();
    expect(rates['never-heard-of-it']).toBeNull();
  });

  it('maps everything to null when the catalog is unavailable', () => {
    const rates = getModelRatesFromCatalog(['claude-test'], null);
    expect(rates['claude-test']).toBeNull();
  });
});
