// AUTO-MERGED test file (see git history for the original per-feature files).
// Merged to amortize the per-file module-import cost across one harness load.

import type { BenchmarkAnalystContext } from '../../types';
import { FetchHandleV2 } from '../fetch-handle';
import { clearHandles, fetchHandle, getHandleTable, queryHandle, storeHandle } from '../handle-store';
import { detectLowLimit, findUnresolvedMongoLabelRefs, interpolateMongoRefs, interpolateRefs } from '../query-refs';
import { computeResultStats } from '../result-stats';
import { buildSampleSql } from '../sample-sql';
import type { QueryResult } from '@/lib/connections/base';
import type { TextContent } from '@/orchestrator/llm';
import { Orchestrator } from '@/orchestrator/orchestrator';

describe('handle-store', () => {
// Tests for the handle store: store/fetch, unique IDs, queryable DuckDB tables




describe('HandleStore', () => {
  beforeEach(async () => {
    await clearHandles();
  });

  describe('storeHandle / fetchHandle', () => {
    it('stores a query result and returns a unique handle ID', async () => {
      const result: QueryResult = {
        columns: ['id', 'name'],
        types: ['INTEGER', 'VARCHAR'],
        rows: [{ id: 1, name: 'Alice' }],
        finalQuery: '',
      };

      const stored = await storeHandle(result);

      expect(stored.handleId).toMatch(/^handle_/);
      expect(stored.error).toBeUndefined();
      expect(fetchHandle(stored.handleId)).toEqual(result);
    });

    it('generates unique handle IDs for each store call', async () => {
      const result: QueryResult = {
        columns: ['x'],
        types: ['INT'],
        rows: [{ x: 1 }],
        finalQuery: '',
      };

      const h1 = await storeHandle(result);
      const h2 = await storeHandle(result);
      const h3 = await storeHandle(result);

      expect(h1.handleId).not.toBe(h2.handleId);
      expect(h2.handleId).not.toBe(h3.handleId);
      expect(h1.handleId).not.toBe(h3.handleId);
    });

    it('returns undefined for unknown handle', () => {
      expect(fetchHandle('handle_unknown')).toBeUndefined();
    });

    it('stores result with empty rows', async () => {
      const result: QueryResult = {
        columns: ['id'],
        types: ['INT'],
        rows: [],
        finalQuery: '',
      };

      const stored = await storeHandle(result);
      expect(stored.error).toBeUndefined();
      expect(fetchHandle(stored.handleId)).toEqual(result);
    });
  });

  describe('clearHandles', () => {
    it('removes all stored handles', async () => {
      const result: QueryResult = {
        columns: ['x'],
        types: ['INT'],
        rows: [{ x: 1 }],
        finalQuery: '',
      };

      const h1 = await storeHandle(result);
      const h2 = await storeHandle(result);

      expect(fetchHandle(h1.handleId)).toBeDefined();
      expect(fetchHandle(h2.handleId)).toBeDefined();

      await clearHandles();

      expect(fetchHandle(h1.handleId)).toBeUndefined();
      expect(fetchHandle(h2.handleId)).toBeUndefined();
    });
  });

  describe('getHandleTable', () => {
    it('returns the DuckDB table name for a handle', async () => {
      const result: QueryResult = {
        columns: ['id'],
        types: ['INT'],
        rows: [{ id: 1 }],
        finalQuery: '',
      };

      const stored = await storeHandle(result);
      const tableName = getHandleTable(stored.handleId);

      expect(tableName).toBe(stored.handleId);
    });

    it('returns undefined for unknown handle', () => {
      expect(getHandleTable('handle_unknown')).toBeUndefined();
    });
  });

  describe('queryHandle (DuckDB queryable table)', () => {
    it('allows SQL queries against the stored handle rows', async () => {
      const result: QueryResult = {
        columns: ['id', 'value'],
        types: ['INTEGER', 'DOUBLE'],
        rows: [
          { id: 1, value: 100 },
          { id: 2, value: 200 },
          { id: 3, value: 150 },
        ],
        finalQuery: '',
      };

      const { handleId } = await storeHandle(result);

      const queryResult = await queryHandle(
        `SELECT id, value FROM ${handleId} WHERE value > 100 ORDER BY value`,
      );

      expect(queryResult.rows).toEqual([
        { id: 3, value: 150 },
        { id: 2, value: 200 },
      ]);
    });

    it('handles aggregate queries on handle data', async () => {
      const result: QueryResult = {
        columns: ['category', 'amount'],
        types: ['VARCHAR', 'DOUBLE'],
        rows: [
          { category: 'A', amount: 10 },
          { category: 'A', amount: 20 },
          { category: 'B', amount: 30 },
        ],
        finalQuery: '',
      };

      const { handleId } = await storeHandle(result);

      const queryResult = await queryHandle(
        `SELECT category, SUM(amount) as total FROM ${handleId} GROUP BY category ORDER BY category`,
      );

      expect(queryResult.rows).toEqual([
        { category: 'A', total: 30 },
        { category: 'B', total: 30 },
      ]);
    });

    // When the source query produces duplicate column names (e.g.
    // `SELECT MIN(a) AS min, MIN(b) AS min`), DuckDB's CREATE TABLE
    // rejects the registration. We don't try to rename or recover —
    // instead, `storeHandle` returns `{ handleId, error }`. The agent
    // gets an actionable error message and can fix the source query if
    // they need the handle for SQL joins. The raw rows remain accessible
    // via `fetchHandle` so the data isn't lost.
    it('returns an error (not a crash) when source columns collide', async () => {
      const result: QueryResult = {
        columns: ['min', 'max', 'min'],
        types: ['INTEGER', 'INTEGER', 'INTEGER'],
        rows: [{ min: 7, max: 99 }],
        finalQuery: '',
      };

      const stored = await storeHandle(result);

      expect(stored.handleId).toMatch(/^handle_/);
      expect(stored.error).toBeDefined();
      // The DuckDB error mentions "min" (the colliding column name).
      expect(stored.error!).toMatch(/min/i);
    });

    it('still stores raw rows in the handle map even when registration fails', async () => {
      const result: QueryResult = {
        columns: ['min', 'min'],
        types: ['INTEGER', 'INTEGER'],
        rows: [{ min: 42 }],
        finalQuery: '',
      };

      const stored = await storeHandle(result);
      expect(stored.error).toBeDefined();
      // Raw rows still accessible via fetchHandle — no data lost
      const fetched = fetchHandle(stored.handleId);
      expect(fetched).toEqual(result);
    });

    it('reports the error message verbatim when querying the un-registered handle fails', async () => {
      // `FROM handle_xyz` against a handle that never registered should
      // surface DuckDB's "table doesn't exist" — agent has been told it
      // wasn't registered (via handle_error), so this is the expected
      // downstream consequence.
      const result: QueryResult = {
        columns: ['x', 'x'],
        types: ['INTEGER', 'INTEGER'],
        rows: [{ x: 1 }],
        finalQuery: '',
      };

      const stored = await storeHandle(result);
      expect(stored.error).toBeDefined();
      await expect(queryHandle(`SELECT * FROM ${stored.handleId}`))
        .rejects.toThrow(/does not exist/i);
    });

    it('supports joining multiple handles', async () => {
      const orders: QueryResult = {
        columns: ['order_id', 'product_id', 'qty'],
        types: ['INT', 'INT', 'INT'],
        rows: [
          { order_id: 1, product_id: 100, qty: 2 },
          { order_id: 2, product_id: 101, qty: 1 },
        ],
        finalQuery: '',
      };
      const products: QueryResult = {
        columns: ['product_id', 'name'],
        types: ['INT', 'VARCHAR'],
        rows: [
          { product_id: 100, name: 'Widget' },
          { product_id: 101, name: 'Gadget' },
        ],
        finalQuery: '',
      };

      const ordersHandle = (await storeHandle(orders)).handleId;
      const productsHandle = (await storeHandle(products)).handleId;

      const queryResult = await queryHandle(
        `SELECT o.order_id, p.name, o.qty
         FROM ${ordersHandle} o
         JOIN ${productsHandle} p ON o.product_id = p.product_id
         ORDER BY o.order_id`,
      );

      expect(queryResult.rows).toEqual([
        { order_id: 1, name: 'Widget', qty: 2 },
        { order_id: 2, name: 'Gadget', qty: 1 },
      ]);
    });
  });
});
});

describe('fetch-handle', () => {
// Tests for fetchHandle tool: pagination over stored results









const CTX: BenchmarkAnalystContext = {
  connections: [],
  contextDocs: '',
};

describe('FetchHandleV2', () => {
  beforeEach(async () => {
    await clearHandles();
  });

  describe('basic pagination', () => {
    it('returns rows from offset to offset+length', async () => {
      const result: QueryResult = {
        columns: ['id', 'value'],
        types: ['INTEGER', 'DOUBLE'],
        rows: Array.from({ length: 100 }, (_, i) => ({ id: i, value: i * 10 })),
        finalQuery: '',
      };
      const { handleId: handle } = await storeHandle(result);

      const orch = new Orchestrator([FetchHandleV2]);
      const tool = new FetchHandleV2(
        orch,
        { handle, offset: 10, length: 5 },
        CTX,
        'test-pagination',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.preview).toBeDefined();
      expect(content.stats.rowCount).toBe(100);
      expect(content.stats.previewCount).toBe(5);
    });

    it('defaults offset to 0 and length to 100', async () => {
      const result: QueryResult = {
        columns: ['id'],
        types: ['INT'],
        rows: Array.from({ length: 200 }, (_, i) => ({ id: i })),
        finalQuery: '',
      };
      const { handleId: handle } = await storeHandle(result);

      const orch = new Orchestrator([FetchHandleV2]);
      const tool = new FetchHandleV2(
        orch,
        { handle },
        CTX,
        'test-defaults',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.stats.previewCount).toBe(100);
    });

    it('clamps to available rows if offset+length exceeds rowCount', async () => {
      const result: QueryResult = {
        columns: ['id'],
        types: ['INT'],
        rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
        finalQuery: '',
      };
      const { handleId: handle } = await storeHandle(result);

      const orch = new Orchestrator([FetchHandleV2]);
      const tool = new FetchHandleV2(
        orch,
        { handle, offset: 1, length: 100 },
        CTX,
        'test-clamp',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.stats.previewCount).toBe(2);
    });

    it('returns empty preview when offset >= rowCount', async () => {
      const result: QueryResult = {
        columns: ['id'],
        types: ['INT'],
        rows: [{ id: 1 }],
        finalQuery: '',
      };
      const { handleId: handle } = await storeHandle(result);

      const orch = new Orchestrator([FetchHandleV2]);
      const tool = new FetchHandleV2(
        orch,
        { handle, offset: 100, length: 10 },
        CTX,
        'test-empty',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.stats.previewCount).toBe(0);
    });
  });

  describe('stats inclusion', () => {
    it('includes column-level stats in the response', async () => {
      const result: QueryResult = {
        columns: ['value', 'category'],
        types: ['INTEGER', 'VARCHAR'],
        rows: [
          { value: 10, category: 'A' },
          { value: 20, category: 'A' },
          { value: 30, category: 'B' },
        ],
        finalQuery: '',
      };
      const { handleId: handle } = await storeHandle(result);

      const orch = new Orchestrator([FetchHandleV2]);
      const tool = new FetchHandleV2(
        orch,
        { handle },
        CTX,
        'test-stats',
      );

      const response = await tool.run();

      expect(response.isError).toBe(false);
      const content = JSON.parse((response.content[0] as TextContent).text);

      expect(content.stats.columns.value.min).toBe(10);
      expect(content.stats.columns.value.max).toBe(30);
      expect(content.stats.columns.category.nDistinct).toBe(2);
    });
  });

  describe('error handling', () => {
    it('returns error for unknown handle', async () => {
      const orch = new Orchestrator([FetchHandleV2]);
      const tool = new FetchHandleV2(
        orch,
        { handle: 'handle_unknown' },
        CTX,
        'test-bad-handle',
      );

      const response = await tool.run();

      expect(response.isError).toBe(true);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.error).toContain('not found');
    });

    it('returns error for negative offset', async () => {
      const result: QueryResult = {
        columns: ['id'],
        types: ['INT'],
        rows: [{ id: 1 }],
        finalQuery: '',
      };
      const { handleId: handle } = await storeHandle(result);

      const orch = new Orchestrator([FetchHandleV2]);
      const tool = new FetchHandleV2(
        orch,
        { handle, offset: -5 },
        CTX,
        'test-bad-offset',
      );

      const response = await tool.run();

      expect(response.isError).toBe(true);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.error).toContain('offset');
    });

    it('returns error for zero or negative length', async () => {
      const result: QueryResult = {
        columns: ['id'],
        types: ['INT'],
        rows: [{ id: 1 }],
        finalQuery: '',
      };
      const { handleId: handle } = await storeHandle(result);

      const orch = new Orchestrator([FetchHandleV2]);
      const tool = new FetchHandleV2(
        orch,
        { handle, length: 0 },
        CTX,
        'test-bad-length',
      );

      const response = await tool.run();

      expect(response.isError).toBe(true);
      const content = JSON.parse((response.content[0] as TextContent).text);
      expect(content.error).toContain('length');
    });
  });

  describe('schema validation', () => {
    it('has correct schema name and description', () => {
      expect(FetchHandleV2.schema.name).toBe('fetchHandle');
      expect(FetchHandleV2.schema.description).toContain('pagination');
    });
  });
});
});

describe('query-refs', () => {
// Tests for the extracted query reference helpers from explore-dataset.ts
// These are the migrated tests from explore-dataset.test.ts for the 3 helpers:
// - interpolateRefs: SQL $label.column interpolation
// - interpolateMongoRefs: Mongo $label.column interpolation
// - detectLowLimit: low limit detection for SQL and Mongo




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
});

describe('result-stats', () => {
// Tests for computeResultStats: generates per-column stats from query results




describe('computeResultStats', () => {
  describe('row counts', () => {
    it('returns correct rowCount and previewCount', () => {
      const result: QueryResult = {
        columns: ['id'],
        types: ['INTEGER'],
        rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 2);

      expect(stats.rowCount).toBe(3);
      expect(stats.previewCount).toBe(2);
    });

    it('handles empty result set', () => {
      const result: QueryResult = {
        columns: ['id'],
        types: ['INTEGER'],
        rows: [],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 10);

      expect(stats.rowCount).toBe(0);
      expect(stats.previewCount).toBe(0);
    });

    it('clamps previewCount to rowCount when smaller', () => {
      const result: QueryResult = {
        columns: ['id'],
        types: ['INTEGER'],
        rows: [{ id: 1 }],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 100);

      expect(stats.rowCount).toBe(1);
      expect(stats.previewCount).toBe(1);
    });
  });

  describe('numeric columns', () => {
    it('computes min/max/avg for numeric columns', () => {
      const result: QueryResult = {
        columns: ['value'],
        types: ['DOUBLE'],
        rows: [{ value: 10 }, { value: 20 }, { value: 30 }],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 3);

      expect(stats.columns.value.min).toBe(10);
      expect(stats.columns.value.max).toBe(30);
      expect(stats.columns.value.avg).toBe(20);
    });

    it('handles null values in numeric columns', () => {
      const result: QueryResult = {
        columns: ['value'],
        types: ['INTEGER'],
        rows: [{ value: 10 }, { value: null }, { value: 30 }],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 3);

      expect(stats.columns.value.min).toBe(10);
      expect(stats.columns.value.max).toBe(30);
      expect(stats.columns.value.avg).toBe(20);
    });

    it('handles INTEGER, BIGINT, DECIMAL types as numeric', () => {
      const result: QueryResult = {
        columns: ['int_col', 'bigint_col', 'decimal_col'],
        types: ['INTEGER', 'BIGINT', 'DECIMAL'],
        rows: [{ int_col: 1, bigint_col: 100, decimal_col: 1.5 }],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 1);

      expect(stats.columns.int_col.min).toBe(1);
      expect(stats.columns.bigint_col.min).toBe(100);
      expect(stats.columns.decimal_col.min).toBe(1.5);
    });
  });

  describe('text/categorical columns', () => {
    it('identifies low-cardinality columns and provides topValues', () => {
      const result: QueryResult = {
        columns: ['category'],
        types: ['VARCHAR'],
        rows: [
          { category: 'A' },
          { category: 'A' },
          { category: 'B' },
          { category: 'A' },
          { category: 'B' },
        ],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 5);

      expect(stats.columns.category.cardinality).toBe('low');
      expect(stats.columns.category.nDistinct).toBe(2);
      expect(stats.columns.category.topValues).toEqual([
        { value: 'A', count: 3 },
        { value: 'B', count: 2 },
      ]);
    });

    it('identifies high-cardinality columns (no topValues)', () => {
      const rows = Array.from({ length: 100 }, (_, i) => ({ id: `unique_${i}` }));
      const result: QueryResult = {
        columns: ['id'],
        types: ['VARCHAR'],
        rows,
        finalQuery: '',
      };

      const stats = computeResultStats(result, 100);

      expect(stats.columns.id.cardinality).toBe('high');
      expect(stats.columns.id.nDistinct).toBe(100);
      expect(stats.columns.id.topValues).toBeUndefined();
    });

    it('computes min/max/avg length for text columns', () => {
      const result: QueryResult = {
        columns: ['name'],
        types: ['VARCHAR'],
        rows: [
          { name: 'a' },       // len 1
          { name: 'abc' },     // len 3
          { name: 'abcde' },   // len 5
        ],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 3);

      expect(stats.columns.name.minLength).toBe(1);
      expect(stats.columns.name.maxLength).toBe(5);
      expect(stats.columns.name.avgLength).toBe(3);
    });
  });

  describe('temporal columns', () => {
    it('computes minDate/maxDate for DATE columns', () => {
      const result: QueryResult = {
        columns: ['created_at'],
        types: ['DATE'],
        rows: [
          { created_at: '2023-01-01' },
          { created_at: '2023-06-15' },
          { created_at: '2023-12-31' },
        ],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 3);

      expect(stats.columns.created_at.minDate).toBe('2023-01-01');
      expect(stats.columns.created_at.maxDate).toBe('2023-12-31');
    });

    it('handles TIMESTAMP columns', () => {
      const result: QueryResult = {
        columns: ['updated_at'],
        types: ['TIMESTAMP'],
        rows: [
          { updated_at: '2023-01-01T00:00:00Z' },
          { updated_at: '2023-12-31T23:59:59Z' },
        ],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 2);

      expect(stats.columns.updated_at.minDate).toBeDefined();
      expect(stats.columns.updated_at.maxDate).toBeDefined();
    });
  });

  describe('mixed columns', () => {
    it('handles results with multiple column types', () => {
      const result: QueryResult = {
        columns: ['id', 'name', 'amount', 'created'],
        types: ['INTEGER', 'VARCHAR', 'DECIMAL', 'DATE'],
        rows: [
          { id: 1, name: 'Alice', amount: 100.5, created: '2023-01-01' },
          { id: 2, name: 'Bob', amount: 200.0, created: '2023-02-01' },
        ],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 2);

      // numeric
      expect(stats.columns.id.min).toBe(1);
      expect(stats.columns.amount.avg).toBe(150.25);

      // text
      expect(stats.columns.name.nDistinct).toBe(2);

      // temporal
      expect(stats.columns.created.minDate).toBe('2023-01-01');
    });
  });

  describe('edge cases', () => {
    it('handles all-null column', () => {
      const result: QueryResult = {
        columns: ['value'],
        types: ['INTEGER'],
        rows: [{ value: null }, { value: null }],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 2);

      expect(stats.columns.value.min).toBeUndefined();
      expect(stats.columns.value.max).toBeUndefined();
    });

    it('handles result with no columns', () => {
      const result: QueryResult = {
        columns: [],
        types: [],
        rows: [],
        finalQuery: '',
      };

      const stats = computeResultStats(result, 0);

      expect(stats.rowCount).toBe(0);
      expect(stats.columns).toEqual({});
    });
  });
});
});

describe('sample-sql', () => {
// Per-dialect sample-SQL builder. Pure function; tests are just shape checks.




describe('buildSampleSql', () => {
  it('uses DuckDB USING SAMPLE for duckdb / sqlite (benchmark-sqlite routes through DuckDB)', () => {
    expect(buildSampleSql('duckdb', 'main', 'orders', 100)).toBe(
      'SELECT * FROM "orders" USING SAMPLE 100 ROWS',
    );
    expect(buildSampleSql('sqlite', 'main', 'orders', 100)).toBe(
      'SELECT * FROM "orders" USING SAMPLE 100 ROWS',
    );
  });

  it('qualifies with schema when not the default `main`', () => {
    expect(buildSampleSql('duckdb', 'public', 'orders', 50)).toBe(
      'SELECT * FROM "public"."orders" USING SAMPLE 50 ROWS',
    );
  });

  // Postgres: was `TABLESAMPLE BERNOULLI(1) LIMIT N`. That's a 1%
  // sample, which on small tables (typical of benchmark datasets — many
  // <100 rows) returns 0 or 1 row. Switched to `ORDER BY RANDOM()
  // LIMIT N` — always returns up to N rows regardless of table size.
  // Slower on huge tables (full sort) but fine for benchmark scale.
  it('uses ORDER BY RANDOM() LIMIT for postgresql (handles small tables)', () => {
    expect(buildSampleSql('postgresql', 'public', 'users', 100)).toBe(
      'SELECT * FROM "public"."users" ORDER BY RANDOM() LIMIT 100',
    );
  });

  // BigQuery: same story — `TABLESAMPLE SYSTEM (1 PERCENT)` is
  // block-level sampling that fails for small tables. `ORDER BY RAND()`
  // is BigQuery's idiomatic random-sample (RAND() not RANDOM()).
  it('uses ORDER BY RAND() LIMIT for bigquery (handles small tables)', () => {
    expect(buildSampleSql('bigquery', 'mydataset', 'events', 100)).toBe(
      'SELECT * FROM `mydataset.events` ORDER BY RAND() LIMIT 100',
    );
  });

  it('emits a Mongo aggregation pipeline JSON for mongo', () => {
    const result = buildSampleSql('mongo', null, 'business', 100);
    expect(JSON.parse(result)).toEqual({
      collection: 'business',
      pipeline: [{ $sample: { size: 100 } }],
    });
  });

  it('falls back to ORDER BY RANDOM() for unknown dialects', () => {
    expect(buildSampleSql('mysql', 'public', 't', 50)).toBe(
      'SELECT * FROM "public"."t" ORDER BY RANDOM() LIMIT 50',
    );
  });

  it('escapes embedded double-quotes in identifiers', () => {
    // The catalog must not let an exotic table name break the SQL.
    expect(buildSampleSql('duckdb', null, 'weird"name', 10)).toBe(
      'SELECT * FROM "weird""name" USING SAMPLE 10 ROWS',
    );
  });
});
});
