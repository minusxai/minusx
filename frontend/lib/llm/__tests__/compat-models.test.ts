// compatibility.json-backed model curation: per-use-case recommended sets and
// defaults, plus the interpretation of a provider entry's `allowedModels`
// (explicit list | 'auto' = the recommended union | absent = everything).
import { describe, it, expect } from 'vitest';
import {
  compatDefaultModel, filterAllowedModels, recommendedModelIds, resolveAllowedModels,
} from '@/lib/llm/compat-models';
import type { LlmProviderEntry } from '@/lib/llm/llm-config-types';

const MODELS = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const entry = (allowedModels?: string[] | 'auto', provider = 'anthropic'): LlmProviderEntry =>
  ({ name: 'p', provider, allowedModels });

describe('compatDefaultModel', () => {
  it('returns the per-use-case default from compatibility.json', () => {
    expect(compatDefaultModel('anthropic', 'analyst')).toBe('claude-sonnet-5');
    expect(compatDefaultModel('anthropic', 'micro')).toBe('claude-haiku-4-5');
  });

  it('returns undefined for providers without compatibility defaults', () => {
    expect(compatDefaultModel('mistral', 'analyst')).toBeUndefined();
    expect(compatDefaultModel('custom', 'analyst')).toBeUndefined();
  });
});

describe('recommendedModelIds', () => {
  it('is per use case, with the union when no use case is given', () => {
    expect(recommendedModelIds('anthropic', 'micro').has('claude-haiku-4-5')).toBe(true);
    expect(recommendedModelIds('anthropic', 'micro').has('claude-sonnet-5')).toBe(false);
    expect(recommendedModelIds('anthropic').has('claude-sonnet-5')).toBe(true);
    expect(recommendedModelIds('anthropic').has('claude-haiku-4-5')).toBe(true);
  });

  it('is empty for unknown providers', () => {
    expect(recommendedModelIds('mistral').size).toBe(0);
  });
});

describe('resolveAllowedModels', () => {
  it('treats absent/empty as unrestricted', () => {
    expect(resolveAllowedModels(undefined)).toBeUndefined();
    expect(resolveAllowedModels(entry(undefined))).toBeUndefined();
    expect(resolveAllowedModels(entry([]))).toBeUndefined();
  });

  it('passes an explicit list through', () => {
    expect(resolveAllowedModels(entry(['b']))).toEqual(['b']);
  });

  it("resolves 'auto' to the provider's recommended union", () => {
    const resolved = resolveAllowedModels(entry('auto'))!;
    expect(resolved).toEqual(expect.arrayContaining(['claude-sonnet-5', 'claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-8']));
  });
});

describe('filterAllowedModels', () => {
  it('passes everything through with no allowlist', () => {
    expect(filterAllowedModels(entry(undefined), MODELS)).toEqual(MODELS);
    expect(filterAllowedModels(undefined, MODELS)).toEqual(MODELS);
  });

  it('filters to the allowlist, always keeping the currently-assigned model', () => {
    expect(filterAllowedModels(entry(['b']), MODELS)).toEqual([{ id: 'b' }]);
    expect(filterAllowedModels(entry(['b']), MODELS, 'c')).toEqual([{ id: 'b' }, { id: 'c' }]);
    expect(filterAllowedModels(entry(['b']), MODELS, 'b')).toEqual([{ id: 'b' }]);
  });

  it("filters to the recommended union under 'auto'", () => {
    const models = [{ id: 'claude-sonnet-5' }, { id: 'claude-haiku-4-5' }, { id: 'not-recommended' }];
    expect(filterAllowedModels(entry('auto'), models)).toEqual([{ id: 'claude-sonnet-5' }, { id: 'claude-haiku-4-5' }]);
  });
});
