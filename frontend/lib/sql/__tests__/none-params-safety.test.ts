/**
 * Param-NAME safety. `applyNoneParams` builds `new RegExp(':' + name)` from raw param keys, and
 * guests control those keys on public pages — a crafted key was a regex-injection / catastrophic-
 * backtracking (ReDoS) vector, and an over-broad pattern could corrupt the allowlisted SQL.
 * Param names must be validated as identifiers (`/^[A-Za-z_][A-Za-z0-9_]*$/`) and anything else
 * DROPPED before any regex is constructed. Values were always bound; this is purely about names.
 */
import { describe, it, expect } from 'vitest';
import { applyNoneParams, isValidParamName } from '@/lib/sql/none-params';
import { sanitizeGuestParams } from '@/lib/query-cache/guest-query.server';

describe('isValidParamName', () => {
  it('accepts identifier-shaped names', () => {
    for (const name of ['a', 'start_date', '_x', 'A9', 'camelCase']) {
      expect(isValidParamName(name), name).toBe(true);
    }
  });
  it('rejects regex metacharacters and non-identifiers', () => {
    for (const name of ['(a+)+', '.*', 'a b', 'a-b', '9lives', '', 'x\\b|y', 'a$', ':a']) {
      expect(isValidParamName(name), name).toBe(false);
    }
  });
});

describe('applyNoneParams — hostile param names', () => {
  it('drops a regex-metachar param name instead of building a RegExp from it', async () => {
    const { sql, params } = await applyNoneParams(
      'SELECT * FROM t WHERE a >= :min',
      { min: 5, '(a+)+$': null, '.*': null },
      'postgres',
    );
    expect(sql).toContain(':min'); // untouched — hostile keys never became patterns
    expect(params).toEqual({ min: 5 });
  });

  it('does not hang on a catastrophic-backtracking-shaped name (ReDoS guard)', async () => {
    const start = Date.now();
    await applyNoneParams(
      `SELECT * FROM t WHERE x = '${'a'.repeat(80)}'`,
      { ['(a+)+b']: null },
      'postgres',
    );
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('still substitutes NULL for a VALID None param name', async () => {
    const { sql, params } = await applyNoneParams(
      'SELECT :tag AS tag FROM t',
      { tag: null },
      'postgres',
    );
    expect(sql).toContain('NULL');
    expect(sql).not.toContain(':tag');
    expect(params).toEqual({});
  });

  it('drops invalid-named params with real values too (they cannot bind to any :token)', async () => {
    const { params } = await applyNoneParams(
      'SELECT * FROM t WHERE a >= :min',
      { min: 5, 'a b': 'x' },
      'postgres',
    );
    expect(params).toEqual({ min: 5 });
  });
});

describe('applyNoneParams — complex query structures', () => {
  it('removes a skipped filter from a CTE used by a UNION ALL query', async () => {
    const query = `WITH filtered_items AS (
  SELECT category_a, category_b, item_name, item_role
  FROM analytics.items
  WHERE category_a = :category_a
),
category_a_nodes AS (
  SELECT CONCAT('a:', category_a) AS id, 'root' AS parent,
    category_a AS node_name, 'Category A' AS node_type
  FROM filtered_items
  GROUP BY category_a
),
category_b_nodes AS (
  SELECT CONCAT('b:', category_a, '|', category_b) AS id,
    CONCAT('a:', category_a) AS parent, category_b AS node_name,
    'Category B' AS node_type
  FROM filtered_items
  GROUP BY category_a, category_b
),
item_nodes AS (
  SELECT CONCAT('item:', category_a, '|', category_b, '|', item_name, '|', item_role) AS id,
    CONCAT('b:', category_a, '|', category_b) AS parent,
    item_name AS node_name, 'Item' AS node_type, item_role AS detail
  FROM filtered_items
  GROUP BY category_a, category_b, item_name, item_role
)
SELECT 'root' AS id, CAST(NULL AS STRING) AS parent, 'All items' AS node_name,
  'Root' AS node_type, CAST(NULL AS STRING) AS detail
UNION ALL
SELECT id, parent, node_name, node_type, CAST(NULL AS STRING) AS detail FROM category_a_nodes
UNION ALL
SELECT id, parent, node_name, node_type, CAST(NULL AS STRING) AS detail FROM category_b_nodes
UNION ALL
SELECT id, parent, node_name, node_type, detail FROM item_nodes`;

    const { sql, params } = await applyNoneParams(
      query,
      { category_a: null },
      'bigquery',
    );

    expect(sql).not.toContain(':category_a');
    expect(sql).not.toMatch(/category_a\s*=\s*NULL/i);
    expect(sql).not.toMatch(/\bWHERE\b/i);
    expect(sql.match(/UNION ALL/gi)).toHaveLength(3);
    expect(params).toEqual({});
  });

  it('removes a skipped predicate from a nested boolean group inside a CTE', async () => {
    const query = `WITH filtered_items AS (
  SELECT category_a, category_b, item_name
  FROM analytics.items
  WHERE state = :state
    AND (category_a = :category_a OR priority = 'high')
),
category_totals AS (
  SELECT category_a, COUNT(*) AS item_count
  FROM filtered_items
  GROUP BY category_a
)
SELECT category_a, item_count
FROM category_totals`;

    const { sql, params } = await applyNoneParams(
      query,
      { state: 'open', category_a: null },
      'bigquery',
    );

    expect(sql).not.toContain(':category_a');
    expect(sql).not.toMatch(/category_a\s*=\s*NULL/i);
    expect(sql).toMatch(/state\s*=\s*:state/i);
    expect(sql).toMatch(/priority\s*=\s*'high'/i);
    expect(params).toEqual({ state: 'open' });
  });

  it('removes skipped WHERE and HAVING predicates from every UNION ALL branch', async () => {
    const query = `SELECT category_a, COUNT(*) AS item_count
FROM analytics.items_current
WHERE region = :region AND category_b = :category_b
GROUP BY category_a
HAVING COUNT(*) >= :min_count
UNION ALL
SELECT category_a, COUNT(*) AS item_count
FROM analytics.items_archive
WHERE region = :region AND category_b = :category_b
GROUP BY category_a
HAVING COUNT(*) >= :min_count`;

    const { sql, params } = await applyNoneParams(
      query,
      { region: 'west', category_b: null, min_count: null },
      'bigquery',
    );

    expect(sql).not.toContain(':category_b');
    expect(sql).not.toContain(':min_count');
    expect(sql).not.toMatch(/\bHAVING\b/i);
    expect(sql.match(/region\s*=\s*:region/gi)).toHaveLength(2);
    expect(sql.match(/UNION ALL/gi)).toHaveLength(1);
    expect(params).toEqual({ region: 'west' });
  });

  it('removes a skipped predicate from a scalar subquery without changing the outer filter', async () => {
    const query = `SELECT i.category_a,
  (
    SELECT COUNT(*)
    FROM analytics.item_events AS e
    WHERE e.category_a = i.category_a AND e.event_type = :event_type
  ) AS event_count
FROM analytics.items AS i
WHERE i.region = :region`;

    const { sql, params } = await applyNoneParams(
      query,
      { event_type: null, region: 'west' },
      'bigquery',
    );

    expect(sql).not.toContain(':event_type');
    expect(sql).not.toMatch(/event_type\s*=\s*NULL/i);
    expect(sql).toMatch(/e\.category_a\s*=\s*i\.category_a/i);
    expect(sql).toMatch(/i\.region\s*=\s*:region/i);
    expect(params).toEqual({ region: 'west' });
  });
});

describe('sanitizeGuestParams — hostile names dropped at the guest boundary', () => {
  it('keeps valid names, drops invalid ones', () => {
    expect(sanitizeGuestParams({ region: 'west', '(a+)+': 'x', '.*': null, n: 3 }))
      .toEqual({ region: 'west', n: 3 });
  });
});
