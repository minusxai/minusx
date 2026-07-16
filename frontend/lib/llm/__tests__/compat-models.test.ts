// compatibility.json-backed model curation: per-use-case recommended sets and
// defaults, plus the interpretation of a provider entry's `allowedModels`
// (explicit list | 'auto' = the recommended union | absent = everything).
// Expected ids are DERIVED from compatibility.json (the contract test guards
// the data itself) so curation edits don't break these logic tests.
import { describe, it, expect } from 'vitest';
import compatibility from '@/compatibility.json';
import {
  compatDefaultModel, filterAllowedModels, recommendedModelIds, resolveAllowedModels,
} from '@/lib/llm/compat-models';
import type { LlmProviderEntry } from '@/lib/llm/llm-config-types';

const ANTHROPIC = (compatibility.llm.providers as {
  id: string; defaults?: Record<string, string>; recommended?: Record<string, string[]>;
}[]).find(p => p.id === 'anthropic')!;
// An id recommended for analyst but not micro — exercises per-use-case scoping.
const ANALYST_ONLY = ANTHROPIC.recommended!['analyst'].find(id => !ANTHROPIC.recommended!['micro'].includes(id))!;
const MICRO_FIRST = ANTHROPIC.recommended!['micro'][0];

const MODELS = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const entry = (allowedModels?: string[] | 'auto', provider = 'anthropic'): LlmProviderEntry =>
  ({ name: 'p', provider, allowedModels });

describe('compatDefaultModel', () => {
  it('returns the per-use-case default from compatibility.json', () => {
    expect(compatDefaultModel('anthropic', 'analyst')).toBe(ANTHROPIC.defaults!['analyst']);
    expect(compatDefaultModel('anthropic', 'micro')).toBe(ANTHROPIC.defaults!['micro']);
  });

  it('returns undefined for providers without compatibility defaults', () => {
    expect(compatDefaultModel('mistral', 'analyst')).toBeUndefined();
    expect(compatDefaultModel('custom', 'analyst')).toBeUndefined();
  });
});

describe('recommendedModelIds', () => {
  it('is per use case, with the union when no use case is given', () => {
    expect(recommendedModelIds('anthropic', 'micro').has(MICRO_FIRST)).toBe(true);
    expect(recommendedModelIds('anthropic', 'micro').has(ANALYST_ONLY)).toBe(false);
    expect(recommendedModelIds('anthropic').has(ANALYST_ONLY)).toBe(true);
    expect(recommendedModelIds('anthropic').has(MICRO_FIRST)).toBe(true);
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
    expect(resolved).toEqual(expect.arrayContaining([...ANTHROPIC.recommended!['analyst'], ...ANTHROPIC.recommended!['micro']]));
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
    const models = [{ id: ANALYST_ONLY }, { id: MICRO_FIRST }, { id: 'not-recommended' }];
    expect(filterAllowedModels(entry('auto'), models)).toEqual([{ id: ANALYST_ONLY }, { id: MICRO_FIRST }]);
  });
});
