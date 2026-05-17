// Tests for the extracted query reference helpers from explore-dataset.ts
// These are the migrated tests from explore-dataset.test.ts for the 3 helpers:
// - interpolateRefs: SQL $label.column interpolation
// - interpolateMongoRefs: Mongo $label.column interpolation
// - detectLowLimit: low limit detection for SQL and Mongo

import { describe, it, expect } from 'vitest';
import {
  interpolateRefs,
  interpolateMongoRefs,
  detectLowLimit,
  findUnresolvedMongoLabelRefs,
} from '../query-refs';

describe('interpolateRefs (SQL)', () => {
  it('replaces $label.column with comma-separated values from labeled results', () => {
    const labeled = new Map([['revenue', [{ id: 10 }, { id: 20 }, { id: 30 }]]]);
    const sql = 'SELECT * FROM products WHERE id IN ($revenue.id)';
    expect(interpolateRefs(sql, labeled)).toBe(
      'SELECT * FROM products WHERE id IN (10, 20, 30)',
    );
  });

  it('single-quote escapes string values', () => {
    const labeled = new Map([['cities', [{ name: 'NYC' }, { name: "LA's best" }]]]);
    const sql = 'SELECT * FROM places WHERE name IN ($cities.name)';
    expect(interpolateRefs(sql, labeled)).toBe(
      "SELECT * FROM places WHERE name IN ('NYC', 'LA''s best')",
    );
  });

  it('returns NULL for unknown label', () => {
    const labeled = new Map([['revenue', [{ id: 1 }]]]);
    expect(interpolateRefs('WHERE id IN ($unknown.id)', labeled)).toBe(
      'WHERE id IN (NULL)',
    );
  });

  it('returns NULL for empty result set', () => {
    const labeled = new Map([['revenue', []]]);
    expect(interpolateRefs('WHERE id IN ($revenue.id)', labeled)).toBe(
      'WHERE id IN (NULL)',
    );
  });

  it('returns NULL for missing column', () => {
    const labeled = new Map([['revenue', [{ id: 1 }]]]);
    expect(interpolateRefs('WHERE id IN ($revenue.missing)', labeled)).toBe(
      'WHERE id IN (NULL)',
    );
  });

  it('filters out null values from the result', () => {
    const labeled = new Map([
      ['data', [{ id: 1 }, { id: null }, { id: 2 }, { id: undefined }]],
    ]);
    expect(interpolateRefs('WHERE id IN ($data.id)', labeled)).toBe(
      'WHERE id IN (1, 2)',
    );
  });

  it('interpolates multiple refs in one query', () => {
    const labeled = new Map([
      ['a', [{ x: 1 }]],
      ['b', [{ y: 'q' }]],
    ]);
    expect(interpolateRefs('WHERE x IN ($a.x) AND y IN ($b.y)', labeled)).toBe(
      "WHERE x IN (1) AND y IN ('q')",
    );
  });
});

describe('interpolateMongoRefs', () => {
  it('replaces a quoted "$label.column" token with a JSON array of values', () => {
    const labeled = new Map([['revenue', [{ id: 10 }, { id: 20 }, { id: 30 }]]]);
    const json =
      '{"collection":"biz","pipeline":[{"$match":{"id":{"$in":"$revenue.id"}}}]}';
    const out = interpolateMongoRefs(json, labeled);
    expect(out).toBe(
      '{"collection":"biz","pipeline":[{"$match":{"id":{"$in":[10,20,30]}}}]}',
    );
    expect(JSON.parse(out)).toBeDefined();
  });

  it('JSON-encodes string values (quoted array elements)', () => {
    const labeled = new Map([['cities', [{ name: 'NYC' }, { name: 'LA' }]]]);
    const out = interpolateMongoRefs('{"$in":"$cities.name"}', labeled);
    expect(out).toBe('{"$in":["NYC","LA"]}');
  });

  it('leaves an unknown label untouched (it is a Mongo field path, not a ref)', () => {
    const labeled = new Map([['revenue', [{ id: 1 }]]]);
    const json = '{"$project":{"n":"$user.name"}}';
    expect(interpolateMongoRefs(json, labeled)).toBe(json);
  });

  it('interpolates a missing/empty column to []', () => {
    const labeled = new Map([['revenue', [{ id: 1 }, { id: 2 }]]]);
    const out = interpolateMongoRefs('{"$in":"$revenue.missing"}', labeled);
    expect(out).toBe('{"$in":[]}');
  });

  it('replaces multiple refs in one pipeline', () => {
    const labeled = new Map([
      ['a', [{ x: 1 }]],
      ['b', [{ y: 'q' }]],
    ]);
    const out = interpolateMongoRefs('["$a.x","$b.y"]', labeled);
    expect(out).toBe('[[1],["q"]]');
  });

  it('replaces an UNQUOTED "$label.column" token (the common SQL-habit mistake)', () => {
    const labeled = new Map([['revenue', [{ id: 10 }, { id: 20 }, { id: 30 }]]]);
    const json =
      '{"collection":"biz","pipeline":[{"$match":{"id":{"$in":$revenue.id}}}]}';
    const out = interpolateMongoRefs(json, labeled);
    expect(out).toBe(
      '{"collection":"biz","pipeline":[{"$match":{"id":{"$in":[10,20,30]}}}]}',
    );
    expect(JSON.parse(out)).toBeDefined();
  });

  it('leaves an unquoted unknown label untouched', () => {
    const labeled = new Map([['revenue', [{ id: 1 }]]]);
    expect(interpolateMongoRefs('{"$in":$user.name}', labeled)).toBe(
      '{"$in":$user.name}',
    );
  });
});

describe('detectLowLimit', () => {
  describe('SQL', () => {
    it('returns null for no LIMIT clause', () => {
      expect(detectLowLimit('SELECT * FROM t', false)).toBeNull();
    });

    it('returns null for LIMIT >= 1000', () => {
      expect(detectLowLimit('SELECT * FROM t LIMIT 1000', false)).toBeNull();
      expect(detectLowLimit('SELECT * FROM t LIMIT 5000', false)).toBeNull();
    });

    it('returns the limit for LIMIT < 1000', () => {
      expect(detectLowLimit('SELECT * FROM t LIMIT 50', false)).toBe(50);
      expect(detectLowLimit('SELECT * FROM t LIMIT 999', false)).toBe(999);
    });

    it('is case-insensitive', () => {
      expect(detectLowLimit('SELECT * FROM t limit 100', false)).toBe(100);
      expect(detectLowLimit('SELECT * FROM t LIMIT 100', false)).toBe(100);
    });
  });

  describe('Mongo', () => {
    it('returns null for no terminal $limit stage', () => {
      const json = '{"collection":"c","pipeline":[{"$match":{}}]}';
      expect(detectLowLimit(json, true)).toBeNull();
    });

    it('returns null for $limit >= 1000', () => {
      const json = '{"collection":"c","pipeline":[{"$limit":1000}]}';
      expect(detectLowLimit(json, true)).toBeNull();
    });

    it('returns the limit for terminal $limit < 1000', () => {
      const json = '{"collection":"c","pipeline":[{"$sort":{"n":-1}},{"$limit":50}]}';
      expect(detectLowLimit(json, true)).toBe(50);
    });

    it('returns null for invalid JSON (let connector surface the error)', () => {
      expect(detectLowLimit('not json', true)).toBeNull();
    });

    it('returns null for empty pipeline', () => {
      expect(detectLowLimit('{"collection":"c","pipeline":[]}', true)).toBeNull();
    });
  });
});

// Preflight validation: catches the "$in needs an array" class of errors
// where the agent referenced a label that doesn't exist (typo or invented
// name), since `interpolateMongoRefs` silently leaves unknown `$x.y` patterns
// alone (they look identical to real Mongo field paths like `$user.name`).
// The check is scoped narrowly: only `$x.y` appearing as the VALUE of an
// `$in` or `$nin` operator is flagged — that context unambiguously expects
// an array, never a field path.
describe('findUnresolvedMongoLabelRefs', () => {
  const known = new Set(['biz_counts', 'users_2016']);

  it('returns empty when no $in/$nin label refs in the pipeline', () => {
    const sql = '{"collection":"c","pipeline":[{"$match":{"name":"alpha"}}]}';
    expect(findUnresolvedMongoLabelRefs(sql, known)).toEqual([]);
  });

  it('returns empty when $in value is a literal array (not a label ref)', () => {
    const sql = '{"collection":"c","pipeline":[{"$match":{"id":{"$in":[1,2,3]}}}]}';
    expect(findUnresolvedMongoLabelRefs(sql, known)).toEqual([]);
  });

  it('returns empty when $in references a KNOWN label', () => {
    const sql = '{"collection":"c","pipeline":[{"$match":{"id":{"$in":"$biz_counts.id"}}}]}';
    expect(findUnresolvedMongoLabelRefs(sql, known)).toEqual([]);
  });

  it('flags an unknown label used inside $in', () => {
    const sql = '{"collection":"c","pipeline":[{"$match":{"id":{"$in":"$business_ids_with_counts.business_id"}}}]}';
    expect(findUnresolvedMongoLabelRefs(sql, known)).toEqual(['business_ids_with_counts']);
  });

  it('flags an unknown label used inside $nin', () => {
    const sql = '{"collection":"c","pipeline":[{"$match":{"id":{"$nin":"$missing.id"}}}]}';
    expect(findUnresolvedMongoLabelRefs(sql, known)).toEqual(['missing']);
  });

  it('deduplicates repeated unknown labels', () => {
    const sql = '{"collection":"c","pipeline":[{"$match":{"$or":[{"a":{"$in":"$x.a"}},{"b":{"$in":"$x.b"}}]}}]}';
    expect(findUnresolvedMongoLabelRefs(sql, known)).toEqual(['x']);
  });

  it('ignores real Mongo field-path uses ($attributes.foo inside $project)', () => {
    // `$attributes.BusinessParking` is a valid Mongo field path in $project,
    // NOT a label ref. The helper only flags $in/$nin contexts.
    const sql = '{"collection":"c","pipeline":[{"$project":{"x":"$attributes.foo"}}]}';
    expect(findUnresolvedMongoLabelRefs(sql, known)).toEqual([]);
  });

  it('returns empty on un-parseable input (no crashes, leave error to the engine)', () => {
    expect(findUnresolvedMongoLabelRefs('not a json string', known)).toEqual([]);
  });
});
