// Facet diffing core — the reusable heart of the append-only-log → LLM-message projection.
// Pure logic, so unit-tested directly: stable content hashing (order-independent) and the
// forward memo that collapses identical repeats to {unchanged:true} while re-emitting changes.
import { describe, it, expect } from 'vitest';
import { facetHash, FacetMemo, isUnchanged, type Diffed } from '../facets';

describe('facetHash', () => {
  it('is stable regardless of object key order (content, not serialization, is the key)', () => {
    expect(facetHash({ a: 1, b: 2 })).toBe(facetHash({ b: 2, a: 1 }));
    expect(facetHash({ x: { p: 1, q: 2 } })).toBe(facetHash({ x: { q: 2, p: 1 } }));
  });

  it('differs when the value differs', () => {
    expect(facetHash({ a: 1 })).not.toBe(facetHash({ a: 2 }));
    expect(facetHash('foo')).not.toBe(facetHash('bar'));
    expect(facetHash([1, 2, 3])).not.toBe(facetHash([1, 3, 2])); // array order is significant
  });

  it('returns a non-empty hex string', () => {
    expect(facetHash({ any: 'thing' })).toMatch(/^[0-9a-f]+$/);
  });
});

describe('isUnchanged', () => {
  it('recognizes only the unchanged marker', () => {
    expect(isUnchanged({ unchanged: true })).toBe(true);
    expect(isUnchanged({ unchanged: false })).toBe(false);
    expect(isUnchanged({ a: 1 })).toBe(false);
    expect(isUnchanged(null)).toBe(false);
    expect(isUnchanged(undefined)).toBe(false);
    expect(isUnchanged('unchanged')).toBe(false);
  });
});

describe('FacetMemo', () => {
  it('emits the full value on first occurrence', () => {
    const m = new FacetMemo();
    expect(m.diff('file:1:data', { name: 'a' })).toEqual({ name: 'a' });
  });

  it('collapses an identical repeat to {unchanged:true}', () => {
    const m = new FacetMemo();
    m.diff('file:1:data', { name: 'a' });
    expect(m.diff('file:1:data', { name: 'a' })).toEqual({ unchanged: true });
  });

  it('re-emits the full value when the facet changes, then collapses the new value', () => {
    const m = new FacetMemo();
    m.diff('file:1:data', { name: 'a' });
    expect(m.diff('file:1:data', { name: 'b' })).toEqual({ name: 'b' }); // changed → full
    expect(m.diff('file:1:data', { name: 'b' })).toEqual({ unchanged: true }); // repeat → marker
  });

  it('tracks facet keys independently (markup unchanged while image changes)', () => {
    const m = new FacetMemo();
    m.diff('file:1:content', { markup: '<x/>' });
    m.diff('file:1:image', { key: 'img-v1' });
    expect(m.diff('file:1:content', { markup: '<x/>' })).toEqual({ unchanged: true });
    expect(m.diff('file:1:image', { key: 'img-v2' })).toEqual({ key: 'img-v2' });
  });

  it('passes undefined through and does not disturb the baseline', () => {
    const m = new FacetMemo();
    m.diff('qr:h1:data', { markdown: 'rows' });
    expect(m.diff('qr:h1:data', undefined)).toBeUndefined(); // absent this turn
    // Reappearing with the SAME value is still unchanged — the absent turn didn't rebase.
    expect(m.diff('qr:h1:data', { markdown: 'rows' })).toEqual({ unchanged: true });
  });

  it('reset() rebases so the next pass re-emits in full (summarization boundary)', () => {
    const m = new FacetMemo();
    m.diff('file:1:data', { name: 'a' });
    expect(m.diff('file:1:data', { name: 'a' })).toEqual({ unchanged: true });
    m.reset();
    expect(m.has('file:1:data')).toBe(false);
    expect(m.diff('file:1:data', { name: 'a' })).toEqual({ name: 'a' }); // full again
  });

  it('forward-only: a stable sequence projects earlier turns identically across runs', () => {
    // Two independent memos fed the same turn sequence must agree turn-for-turn — this is the
    // determinism the provider prompt cache relies on.
    const turns: Array<{ key: string; value: unknown }> = [
      { key: 'file:1:data', value: { name: 'a' } },
      { key: 'file:1:data', value: { name: 'a' } },
      { key: 'file:1:data', value: { name: 'b' } },
    ];
    const run = () => {
      const m = new FacetMemo();
      return turns.map((t) => m.diff(t.key, t.value) as Diffed<unknown>);
    };
    expect(run()).toEqual(run());
    expect(run()).toEqual([{ name: 'a' }, { unchanged: true }, { name: 'b' }]);
  });
});
