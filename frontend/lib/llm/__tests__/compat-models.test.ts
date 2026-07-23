// compatibility.json-backed model curation: one default model per grade (the
// "Auto" pick). Expected ids are DERIVED from compatibility.json (the contract
// test guards the data itself) so curation edits don't break these logic tests.
import { describe, it, expect } from 'vitest';
import compatibility from '@/compatibility.json';
import { compatDefaultModel } from '@/lib/llm/compat-models';

const ANTHROPIC = (compatibility.llm.providers as {
  id: string; defaults?: Record<string, string>;
}[]).find(p => p.id === 'anthropic')!;

describe('compatDefaultModel', () => {
  it('returns the per-grade default from compatibility.json', () => {
    expect(compatDefaultModel('anthropic', 'lite')).toBe(ANTHROPIC.defaults!['lite']);
    expect(compatDefaultModel('anthropic', 'core')).toBe(ANTHROPIC.defaults!['core']);
    expect(compatDefaultModel('anthropic', 'advanced')).toBe(ANTHROPIC.defaults!['advanced']);
  });

  it('returns undefined for providers without compatibility defaults', () => {
    expect(compatDefaultModel('mistral', 'core')).toBeUndefined();
    expect(compatDefaultModel('custom', 'core')).toBeUndefined();
  });
});
