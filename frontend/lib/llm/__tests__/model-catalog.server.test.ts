// Live models.dev catalog overlay: parsing, merge with the baked registry,
// and plan-time resolution of model ids newer than the pinned pi-ai version.
import { describe, it, expect } from 'vitest';
import { parseModelsDevCatalog, mergedListModels } from '../model-catalog.server';
import { buildPlanStep } from '../llm-plan.server';

const MODELS_DEV_JSON = {
  openai: {
    id: 'openai',
    models: {
      'gpt-5.6': {
        id: 'gpt-5.6', name: 'GPT-5.6', reasoning: true,
        modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
        limit: { context: 1_050_000, output: 128_000 },
        cost: { input: 10, output: 60, cache_read: 1, cache_write: 12.5 },
      },
      'gpt-4.1': { id: 'gpt-4.1', name: 'GPT-4.1 (live)', reasoning: false },
      // Non-chat models (image generation, tts) must be EXCLUDED — they broke
      // the Test button (alphabetical fallback picked chatgpt-image-latest)
      // and polluted the model pickers.
      'chatgpt-image-latest': {
        id: 'chatgpt-image-latest', name: 'ChatGPT Image',
        modalities: { input: ['text', 'image'], output: ['image'] },
      },
      'tts-1': { id: 'tts-1', name: 'TTS-1', modalities: { input: ['text'], output: ['audio'] } },
    },
  },
  'not-a-pi-provider': { id: 'not-a-pi-provider', models: { 'x-1': { id: 'x-1', name: 'X-1' } } },
  broken: { id: 'broken' },
};

describe('parseModelsDevCatalog', () => {
  it('parses providers/models with metadata; unsupported modalities filtered to text/image', () => {
    const catalog = parseModelsDevCatalog(MODELS_DEV_JSON);
    const model = catalog.get('openai')!.get('gpt-5.6')!;
    expect(model.name).toBe('GPT-5.6');
    expect(model.reasoning).toBe(true);
    expect(model.input).toEqual(['text', 'image']);   // pdf dropped
    expect(model.contextWindow).toBe(1_050_000);
    expect(model.maxTokens).toBe(128_000);
    expect(model.cost).toEqual({ input: 10, output: 60, cacheRead: 1, cacheWrite: 12.5 });
    expect(catalog.get('broken')).toBeUndefined();    // provider without models skipped
  });

  it('tolerates junk input', () => {
    expect(parseModelsDevCatalog(null).size).toBe(0);
    expect(parseModelsDevCatalog('nope').size).toBe(0);
  });

  it('excludes non-chat models (image/audio output) — chat pickers and test defaults only', () => {
    const catalog = parseModelsDevCatalog(MODELS_DEV_JSON);
    expect(catalog.get('openai')!.get('chatgpt-image-latest')).toBeUndefined();
    expect(catalog.get('openai')!.get('tts-1')).toBeUndefined();
    expect(catalog.get('openai')!.get('gpt-5.6')).toBeDefined();
    // Models without modalities metadata are kept (assumed chat).
    expect(catalog.get('openai')!.get('gpt-4.1')).toBeDefined();
  });
});

describe('mergedListModels', () => {
  const catalog = parseModelsDevCatalog(MODELS_DEV_JSON);

  it('unions baked + live models; live metadata wins on collisions', () => {
    const merged = mergedListModels('openai', catalog);
    const ids = merged.map(m => m.id);
    expect(ids).toContain('gpt-5.6');                        // live-only model appears
    expect(ids).toContain('gpt-4o');                         // baked models retained
    expect(merged.find(m => m.id === 'gpt-4.1')!.name).toBe('GPT-4.1 (live)'); // live wins
  });

  it('falls back to the baked list without a catalog', () => {
    const baked = mergedListModels('openai', null);
    expect(baked.length).toBeGreaterThan(10);
    expect(baked.map(m => m.id)).not.toContain('gpt-5.6');
  });
});

describe('buildPlanStep with a live catalog', () => {
  const catalog = parseModelsDevCatalog(MODELS_DEV_JSON);
  const entry = { name: 'oa', provider: 'openai', apiKey: 'k' };

  it('resolves a model id newer than the baked registry via the catalog', () => {
    const step = buildPlanStep(entry, { providerName: 'oa', model: 'gpt-5.6' }, 'analyst', catalog);
    const model = step.model as { id: string; provider: string; contextWindow: number; reasoning: boolean };
    expect(model.id).toBe('gpt-5.6');
    expect(model.provider).toBe('openai');
    expect(model.contextWindow).toBe(1_050_000);
    expect(model.reasoning).toBe(true);
    expect(step.callOptions?.apiKey).toBe('k');
  });

  it('still throws for a model unknown to both registry and catalog', () => {
    expect(() => buildPlanStep(entry, { providerName: 'oa', model: 'gpt-99-fake' }, 'analyst', catalog))
      .toThrow(/not in the model registry/);
  });

  it('baked registry models are unaffected by the catalog', () => {
    const step = buildPlanStep(entry, { providerName: 'oa', model: 'gpt-4.1' }, 'analyst', catalog);
    expect((step.model as { id: string }).id).toBe('gpt-4.1');
  });
});
