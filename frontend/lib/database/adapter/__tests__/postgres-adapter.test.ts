import { describe, it, expect } from 'vitest';
import { serializePgParams } from '../postgres-adapter';
import { sqlArray } from '../types';

// node-postgres serializes a JS array param to a Postgres array literal `{...}`,
// which is correct for `= ANY($1)` but invalid for a JSONB column (which wants
// JSON `[...]`). The adapter therefore JSON-stringifies plain arrays (JSONB) but
// must pass `sqlArray()`-wrapped params through natively (for ANY()/array params).
describe('serializePgParams', () => {
  it('JSON-stringifies plain arrays (destined for JSONB columns)', () => {
    expect(serializePgParams([[1, 2, 3]])).toEqual(['[1,2,3]']);
  });

  it('passes sqlArray() through as a native array (for `= ANY($1)`)', () => {
    expect(serializePgParams([sqlArray([589, 619, 910])])).toEqual([[589, 619, 910]]);
  });

  it('leaves scalars untouched', () => {
    expect(serializePgParams(['x', 5, null, true])).toEqual(['x', 5, null, true]);
  });

  it('mixes JSONB arrays and sqlArray params in one call', () => {
    expect(serializePgParams([sqlArray([1, 2]), [3, 4], 'k'])).toEqual([[1, 2], '[3,4]', 'k']);
  });
});
