/**
 * Tier-1 semantic model validation (Semantic_Model_v2.md §2.3/§2.5, M1).
 * One test per validated rule; fixtures mirror the m2m derisk scenario
 * (orders / customers / tags / order_tags + a `costs` view).
 */
import { describe, it, expect } from 'vitest';
import { validateSemanticModel, lexMetricSql, type SemanticModelCtx } from '../validate';
import type { SemanticModelV2 } from '@/lib/types/semantic';
import type { DatabaseWithSchema, ViewDef } from '@/lib/types';

const col = (name: string, type: string) => ({ name, type });

const FULL_SCHEMA: DatabaseWithSchema[] = [{
  databaseName: 'wh',
  schemas: [{
    schema: 'main',
    tables: [
      { table: 'orders', columns: [col('id', 'INTEGER'), col('amount', 'DOUBLE'), col('created_at', 'TIMESTAMP'), col('customer_id', 'INTEGER'), col('region', 'VARCHAR')] },
      { table: 'customers', columns: [col('id', 'INTEGER'), col('name', 'VARCHAR')] },
      { table: 'tags', columns: [col('id', 'INTEGER'), col('name', 'VARCHAR'), col('weight', 'DOUBLE')] },
      { table: 'order_tags', columns: [col('order_id', 'INTEGER'), col('tag_id', 'INTEGER')] },
      { table: 'mystery', columns: [col('when_col', ''), col('val', '')] },  // unprofiled: unknown types
    ],
  }],
}, {
  databaseName: 'other_wh',
  schemas: [{ schema: 'main', tables: [{ table: 'events', columns: [col('id', 'INTEGER')] }] }],
}];

const COSTS_VIEW: ViewDef = {
  name: 'costs',
  connection: 'wh',
  sql: 'SELECT order_id, SUM(cost) AS total FROM raw_costs GROUP BY order_id',
  columns: [col('order_id', 'INTEGER'), col('total', 'DOUBLE'), col('hidden_col', 'DOUBLE')],
  whitelistedColumns: ['order_id', 'total'],
};

const CTX: SemanticModelCtx = {
  fullSchema: FULL_SCHEMA,
  views: [COSTS_VIEW],
  otherModelNames: ['Inventory'],
};

/** A fully valid model — the baseline every test mutates. */
const validModel = (): SemanticModelV2 => ({
  name: 'Orders',
  connection: 'wh',
  primary: { kind: 'table', schema: 'main', table: 'orders' },
  primaryKey: ['id'],
  references: [
    {
      source: { kind: 'table', schema: 'main', table: 'customers' },
      alias: 'customers',
      relationship: 'many_to_one',
      on: [{ primaryColumn: 'customer_id', referencedColumn: 'id' }],
    },
    {
      source: { kind: 'model', view: 'costs' },
      alias: 'costs',
      relationship: 'one_to_one',
      on: [{ primaryColumn: 'id', referencedColumn: 'order_id' }],
    },
    {
      source: { kind: 'table', schema: 'main', table: 'tags' },
      alias: 'tags',
      relationship: 'many_to_many',
      through: {
        source: { kind: 'table', schema: 'main', table: 'order_tags' },
        primaryOn: [{ primaryColumn: 'id', bridgeColumn: 'order_id' }],
        referencedOn: [{ bridgeColumn: 'tag_id', referencedColumn: 'id' }],
      },
    },
  ],
  dimensions: [
    { name: 'Region', source: 'primary', column: 'region' },
    { name: 'Customer Name', source: 'customers', column: 'name' },
    { name: 'Tag', source: 'tags', column: 'name' },
    { name: 'Created At', source: 'primary', column: 'created_at', temporal: true },
  ],
  metrics: [
    { name: 'Order Count', type: 'aggregation', agg: 'COUNT' },
    { name: 'Revenue', type: 'aggregation', agg: 'SUM', column: 'amount' },
    { name: 'AOV', type: 'ratio', numerator: 'Revenue', denominator: 'Order Count' },
    { name: 'Net Revenue', type: 'sql', sql: 'SUM(primary.amount) - SUM(costs.total)' },
  ],
});

const errorsFor = (mutate: (m: SemanticModelV2) => void, ctx: SemanticModelCtx = CTX): string[] => {
  const m = validModel();
  mutate(m);
  return validateSemanticModel(m, ctx);
};

describe('validateSemanticModel — baseline', () => {
  it('accepts a fully valid model (empty issues)', () => {
    expect(validateSemanticModel(validModel(), CTX)).toEqual([]);
  });
});

describe('names & namespaces', () => {
  it('rejects slug collisions across dimensions/metrics (case-insensitive)', () => {
    const issues = errorsFor((m) => { m.metrics.push({ name: 'REGION', type: 'aggregation', agg: 'SUM', column: 'amount' }); });
    expect(issues.some((e) => e.includes('REGION') && e.toLowerCase().includes('unique'))).toBe(true);
  });

  it('rejects duplicate reference aliases', () => {
    const issues = errorsFor((m) => {
      m.references!.push({
        source: { kind: 'table', schema: 'main', table: 'customers' },
        alias: 'customers',
        relationship: 'many_to_one',
        on: [{ primaryColumn: 'customer_id', referencedColumn: 'id' }],
      });
    });
    expect(issues.some((e) => e.includes('customers') && e.toLowerCase().includes('alias'))).toBe(true);
  });

  it.each(['primary', '_m2m_tags', '_grain', '_views', '_probe'])('rejects reserved alias "%s"', (alias) => {
    const issues = errorsFor((m) => { (m.references![0] as { alias: string }).alias = alias; });
    expect(issues.some((e) => e.includes(alias) && e.toLowerCase().includes('reserved'))).toBe(true);
  });

  it('rejects a model name colliding with a view name', () => {
    const issues = errorsFor((m) => { m.name = 'costs'; });
    expect(issues.some((e) => e.includes('costs') && e.toLowerCase().includes('view'))).toBe(true);
  });

  it('rejects a model name colliding with another semantic model (case-insensitive)', () => {
    const issues = errorsFor((m) => { m.name = 'inventory'; });
    expect(issues.some((e) => e.toLowerCase().includes('model') && e.toLowerCase().includes('inventory'))).toBe(true);
  });

  it('rejects an empty model name', () => {
    const issues = errorsFor((m) => { m.name = '  '; });
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe('connection consistency & source resolution', () => {
  it('rejects a table source not exposed on the model connection', () => {
    const issues = errorsFor((m) => {
      (m.references![0] as { source: unknown }).source = { kind: 'table', schema: 'main', table: 'events' };
    });
    expect(issues.some((e) => e.includes('events'))).toBe(true);
  });

  it('rejects a view source on a different connection', () => {
    const otherView: ViewDef = { ...COSTS_VIEW, name: 'costs2', connection: 'other_wh' };
    const issues = errorsFor((m) => {
      (m.references![1] as { source: unknown }).source = { kind: 'model', view: 'costs2' };
    }, { ...CTX, views: [COSTS_VIEW, otherView] });
    expect(issues.some((e) => e.includes('costs2') && e.toLowerCase().includes('connection'))).toBe(true);
  });

  it('rejects a view source that does not exist', () => {
    const issues = errorsFor((m) => {
      (m.references![1] as { source: unknown }).source = { kind: 'model', view: 'nope' };
    });
    expect(issues.some((e) => e.includes('nope'))).toBe(true);
  });

  it('rejects an m2m bridge source on a different connection', () => {
    const issues = errorsFor((m) => {
      (m.references![2] as { through: { source: unknown } }).through.source = { kind: 'table', schema: 'main', table: 'events' };
    });
    expect(issues.some((e) => e.includes('events'))).toBe(true);
  });
});

describe('names-only (bounded) schemas — columns stripped from the menu', () => {
  it('a table with UNDEFINED columns never crashes validation', () => {
    const ctx = {
      fullSchema: [{
        databaseName: 'warehouse',
        schemas: [{ schema: 'big', tables: [{ table: 'events' }] }],
      }],
      views: [],
    } as never;
    const model: SemanticModelV2 = {
      name: 'Events', connection: 'warehouse',
      primary: { kind: 'table', schema: 'big', table: 'events' },
      dimensions: [{ name: 'Kind', source: 'primary', column: 'kind' }],
      metrics: [{ name: 'Count', type: 'aggregation', agg: 'COUNT' }],
    };
    expect(() => validateSemanticModel(model, ctx)).not.toThrow();
  });
});

describe('unbalanced parentheses in metric SQL (tier 1 — no engine round-trip needed)', () => {
  it('an unclosed "(" is reported with a message about the AUTHORED SQL', () => {
    const issues = errorsFor((m) => {
      m.metrics = [...m.metrics, { name: 'Net', type: 'sql', sql: 'SUM(primary.amount) - SUM(primary.amount' }];
    });
    expect(issues.some((i) => i.includes('metric "Net"') && i.includes('unbalanced parentheses') && i.includes('never closed'))).toBe(true);
  });

  it('an extra ")" is reported too', () => {
    const issues = errorsFor((m) => {
      m.metrics = [...m.metrics, { name: 'Net', type: 'sql', sql: 'SUM(primary.amount))' }];
    });
    expect(issues.some((i) => i.includes('metric "Net"') && i.includes('unbalanced parentheses'))).toBe(true);
  });

  it('parens inside strings and comments do not count', () => {
    const issues = errorsFor((m) => {
      m.metrics = [...m.metrics, {
        name: 'Net', type: 'sql',
        sql: "COUNT(CASE WHEN primary.region = '(east' THEN 1 END) -- (note\n + SUM(primary.amount)",
      }];
    });
    expect(issues.some((i) => i.includes('unbalanced'))).toBe(false);
  });
});

describe('dimensions, aggregation metrics, temporal dimensions', () => {
  it('rejects a dimension whose source is not primary or a declared alias', () => {
    const issues = errorsFor((m) => { m.dimensions[0].source = 'ghost'; });
    expect(issues.some((e) => e.includes('ghost'))).toBe(true);
  });

  it('rejects a dimension column not exposed on its source', () => {
    const issues = errorsFor((m) => { m.dimensions[0].column = 'nope_col'; });
    expect(issues.some((e) => e.includes('nope_col'))).toBe(true);
  });

  it('rejects a dimension column hidden by a view whitelist', () => {
    const issues = errorsFor((m) => {
      m.dimensions.push({ name: 'Hidden', source: 'costs', column: 'hidden_col' });
    });
    expect(issues.some((e) => e.includes('hidden_col'))).toBe(true);
  });

  it('rejects an aggregation metric column not exposed on the PRIMARY', () => {
    // `name` exists on customers but aggregation metrics are primary-only by construction.
    const issues = errorsFor((m) => { m.metrics.push({ name: 'Bad Measure', type: 'aggregation', agg: 'SUM', column: 'name' }); });
    expect(issues.some((e) => e.includes('Bad Measure') || e.includes('name'))).toBe(true);
  });

  it('rejects a temporal-flagged dimension whose known column type is not date/time-like', () => {
    const issues = errorsFor((m) => {
      m.dimensions.push({ name: 'Bad Time', source: 'primary', column: 'region', temporal: true });
    });
    expect(issues.some((e) => e.includes('region') && e.toLowerCase().includes('temporal'))).toBe(true);
  });

  it('SKIPS the temporal-type check when the column type is unknown (unprofiled)', () => {
    const issues = errorsFor((m) => {
      m.primary = { kind: 'table', schema: 'main', table: 'mystery' };
      m.primaryKey = undefined;
      m.references = [];
      m.dimensions = [{ name: 'When', source: 'primary', column: 'when_col', temporal: true }];
      m.metrics = [{ name: 'Rows', type: 'aggregation', agg: 'COUNT' }];
    });
    expect(issues).toEqual([]);
  });
});

describe('m2m rules', () => {
  it('requires primaryKey when any m2m reference exists', () => {
    const issues = errorsFor((m) => { m.primaryKey = undefined; });
    expect(issues.some((e) => e.toLowerCase().includes('primarykey'))).toBe(true);
  });

  it('allows primaryKey with no m2m references', () => {
    const issues = errorsFor((m) => {
      m.references = m.references!.slice(0, 2);
      m.dimensions = m.dimensions.filter((d) => d.source !== 'tags');
    });
    expect(issues).toEqual([]);
  });

  it('ACCEPTS a composite primaryKey when the bridge correlates on the same columns', () => {
    // Composite m2m is supported now that the semi-join is a correlated EXISTS
    // (one correlation term per key column) rather than a single-column IN.
    const issues = errorsFor((m) => {
      m.primaryKey = ['id', 'region'];
      (m.references![2] as { through: { primaryOn: unknown[] } }).through.primaryOn = [
        { primaryColumn: 'id', bridgeColumn: 'order_id' },
        { primaryColumn: 'region', bridgeColumn: 'region' },
      ];
    });
    expect(issues).toEqual([]);
  });

  it('still rejects composite through keys that do NOT match the declared primaryKey', () => {
    const issues = errorsFor((m) => {
      (m.references![2] as { through: { primaryOn: unknown[] } }).through.primaryOn = [
        { primaryColumn: 'id', bridgeColumn: 'order_id' },
        { primaryColumn: 'region', bridgeColumn: 'region' },
      ];
      // primaryKey stays ['id'] — the grain would silently differ.
    });
    expect(issues.some((e) => e.includes('primaryKey'))).toBe(true);
  });
});

describe('ratio metrics', () => {
  it('rejects numerator/denominator that are not declared aggregation metrics', () => {
    const issues = errorsFor((m) => {
      m.metrics!.push({ name: 'Broken Ratio', type: 'ratio', numerator: 'Revenue', denominator: 'Ghost Measure' });
    });
    expect(issues.some((e) => e.includes('Ghost Measure'))).toBe(true);
  });
});

describe('SQL metric refs (lexer-backed rules)', () => {
  it('rejects refs to an m2m alias (fan-out through the side door)', () => {
    const issues = errorsFor((m) => {
      m.metrics!.push({ name: 'Tag Weight', type: 'sql', sql: 'SUM(tags.weight)' });
    });
    expect(issues.some((e) => e.includes('tags') && e.toLowerCase().includes('m2m') || e.toLowerCase().includes('many'))).toBe(true);
  });

  it('rejects refs to an unknown alias', () => {
    const issues = errorsFor((m) => {
      m.metrics!.push({ name: 'Mystery', type: 'sql', sql: 'SUM(ghost.amount)' });
    });
    expect(issues.some((e) => e.includes('ghost'))).toBe(true);
  });

  it('rejects a qualified column not exposed on its source', () => {
    const issues = errorsFor((m) => {
      m.metrics!.push({ name: 'Bad Col', type: 'sql', sql: 'SUM(primary.nope_col)' });
    });
    expect(issues.some((e) => e.includes('nope_col'))).toBe(true);
  });

  it('rejects unqualified refs that match exposed fields, listing candidates', () => {
    // `amount` is exposed on primary — bare use is ambiguous by policy.
    const issues = errorsFor((m) => {
      m.metrics!.push({ name: 'Bare', type: 'sql', sql: 'SUM(amount)' });
    });
    expect(issues.some((e) => e.includes('amount') && e.includes('primary.amount'))).toBe(true);
  });

  it('rejects quoted identifiers with the rename-via-data-model pointer', () => {
    const issues = errorsFor((m) => {
      m.metrics!.push({ name: 'Quoted', type: 'sql', sql: 'SUM(primary."Order Total")' });
    });
    expect(issues.some((e) => e.toLowerCase().includes('quoted'))).toBe(true);
  });

  it('ignores refs inside string literals and comments', () => {
    const issues = errorsFor((m) => {
      m.metrics!.push({
        name: 'Commented',
        type: 'sql',
        sql: "SUM(CASE WHEN primary.region = 'ghost.amount' THEN primary.amount ELSE 0 END) -- tags.weight here is a comment",
      });
    });
    expect(issues).toEqual([]);
  });
});

describe('lexMetricSql', () => {
  const FIELDS = new Map<string, Set<string>>([
    ['primary', new Set(['amount', 'region'])],
    ['costs', new Set(['total'])],
  ]);

  it('extracts qualified refs outside strings/comments only', () => {
    const r = lexMetricSql(
      "SUM(primary.amount) /* costs.total */ + SUM(costs.total) -- primary.region\n + CASE WHEN primary.region = 'x.y' THEN 1 ELSE 0 END",
      FIELDS,
    );
    expect(r.refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ alias: 'primary', column: 'amount' }),
      expect.objectContaining({ alias: 'costs', column: 'total' }),
      expect.objectContaining({ alias: 'primary', column: 'region' }),
    ]));
    expect(r.refs).toHaveLength(3);
    expect(r.quoted).toBe(false);
  });

  it('flags bare identifiers matching known fields with their candidates', () => {
    const r = lexMetricSql('SUM(amount) + COUNT(*)', FIELDS);
    expect(r.bare).toEqual([{ ident: 'amount', candidates: ['primary.amount'] }]);
  });

  it('does not flag SQL keywords or function names as bare refs', () => {
    const r = lexMetricSql("SUM(CASE WHEN primary.region = 'east' THEN primary.amount ELSE 0 END)", FIELDS);
    expect(r.bare).toEqual([]);
  });

  it('detects quoted identifiers (double quotes and backticks)', () => {
    expect(lexMetricSql('SUM("My Col")', FIELDS).quoted).toBe(true);
    expect(lexMetricSql('SUM(`My Col`)', FIELDS).quoted).toBe(true);
    expect(lexMetricSql("SUM(primary.amount) + 'a \"quoted\" string'", FIELDS).quoted).toBe(false);
  });

describe('runtime shape gate (agent-authored JSON is not type-checked)', () => {
  const bad = (m: unknown): string[] => validateSemanticModel(m as never, CTX);

  it('reports missing required fields instead of throwing', () => {
    expect(() => bad({ name: 'X', connection: 'wh' })).not.toThrow();
    expect(bad({ name: 'X', connection: 'wh' })[0]).toMatch(/malformed model/i);
  });

  it('reports a to-one reference missing relationship/on instead of passing it through', () => {
    const m = validModel() as unknown as { references: unknown[] };
    m.references = [{ source: { kind: 'table', schema: 'main', table: 'customers' }, alias: 'c' }];
    const issues = bad(m);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toMatch(/malformed model/i);
  });

  it('reports an m2m reference missing `through` instead of throwing', () => {
    const m = validModel() as unknown as { references: unknown[] };
    m.references = [{ source: { kind: 'table', schema: 'main', table: 'tags' }, alias: 't', relationship: 'many_to_many' }];
    expect(() => bad(m)).not.toThrow();
    expect(bad(m)[0]).toMatch(/malformed model/i);
  });
});

describe('m2m grain: primaryKey must match the bridge join key', () => {
  it('rejects through.primaryOn disagreeing with the declared primaryKey', () => {
    const issues = errorsFor((m) => {
      (m.references![2] as { through: { primaryOn: { primaryColumn: string; bridgeColumn: string }[] } })
        .through.primaryOn = [{ primaryColumn: 'region', bridgeColumn: 'order_id' }];
    });
    expect(issues.some((e) => e.includes('primaryKey') && e.includes('region'))).toBe(true);
  });
});

describe('metric SQL: every bare ref must be qualified', () => {
  it('rejects a CASE-MISMATCHED bare ref that no exact-case lookup would find', () => {
    const issues = errorsFor((m) => {
      m.metrics!.push({ name: 'Cased', type: 'sql', sql: 'SUM(AMOUNT)' });
    });
    expect(issues.some((e) => e.includes('AMOUNT'))).toBe(true);
  });

  it('rejects a bare ref that matches no exposed field at all', () => {
    const issues = errorsFor((m) => {
      m.metrics!.push({ name: 'Unknown', type: 'sql', sql: 'SUM(mystery_col)' });
    });
    expect(issues.some((e) => e.includes('mystery_col') && e.includes('not qualified'))).toBe(true);
  });
});

});
