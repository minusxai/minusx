/**
 * Derived semantic models — profiled schema → draft SemanticModelV2[] (the
 * suggestion engine; no authored config, no joins). Ends with an end-to-end
 * proof: SQL written against a derived model detects back into a semantic spec.
 */
import { describe, it, expect } from 'vitest';
import { deriveSemanticModels, deriveModelStubs, classifyColumn, humanizeName } from '../derive';
import { detectSemanticQuery } from '../detect-sql';
import type { DatabaseWithSchema, SemanticModelV2 } from '@/lib/types';

const col = (name: string, type: string, category?: 'categorical' | 'numeric' | 'temporal' | 'text' | 'other') =>
  category ? { name, type, meta: { category } } : { name, type };

const db = (
  databaseName: string,
  tables: Record<string, Array<{ name: string; type: string; meta?: object }>>,
  schema = 'public',
): DatabaseWithSchema => ({
  databaseName,
  schemas: [{ schema, tables: Object.entries(tables).map(([table, columns]) => ({ table, columns })) }],
});

const ORDERS = db('warehouse', {
  orders: [
    col('id', 'INTEGER', 'numeric'),
    col('customer_id', 'INTEGER', 'numeric'),
    col('status', 'VARCHAR', 'categorical'),
    col('amount', 'DOUBLE', 'numeric'),
    col('discount', 'DOUBLE', 'numeric'),
    col('created_at', 'TIMESTAMP', 'temporal'),
    col('shipped_date', 'DATE', 'temporal'),
  ],
  customers: [
    col('id', 'INTEGER', 'numeric'),
    col('name', 'VARCHAR', 'text'),
    col('segment', 'VARCHAR', 'categorical'),
    col('signup_date', 'DATE', 'temporal'),
  ],
});

const modelFor = (models: SemanticModelV2[], table: string) => {
  const m = models.find((x) => x.primary.kind === 'table' && x.primary.table === table);
  expect(m, `expected a derived model for ${table}`).toBeTruthy();
  return m!;
};

describe('humanizeName', () => {
  it('title-cases snake_case, kebab-case and lone words', () => {
    expect(humanizeName('order_items')).toBe('Order Items');
    expect(humanizeName('order-items')).toBe('Order Items');
    expect(humanizeName('customers')).toBe('Customers');
    expect(humanizeName('WEB_EVENTS')).toBe('Web Events');
  });
});

describe('classifyColumn', () => {
  it('uses profiled category when present', () => {
    expect(classifyColumn(col('status', 'VARCHAR', 'categorical'))).toBe('dimension');
    expect(classifyColumn(col('amount', 'VARCHAR', 'numeric'))).toBe('measure'); // profiled numeric, odd type
    expect(classifyColumn(col('created_at', 'VARCHAR', 'temporal'))).toBe('time');
  });

  it('a numeric SQL TYPE is always measure-worthy — profiling cannot demote it', () => {
    // Profilers tag low-cardinality integers (clicks, impressions) as
    // "categorical" for LLM context; that must not strip their aggregates.
    expect(classifyColumn(col('clicks', 'BIGINT', 'categorical'))).toBe('measure');
    expect(classifyColumn(col('spend', 'DOUBLE', 'categorical'))).toBe('measure');
    expect(classifyColumn(col('notes', 'DOUBLE', 'text'))).toBe('measure');
  });

  it('falls back to the SQL type name when unprofiled', () => {
    expect(classifyColumn(col('amount', 'DECIMAL(10,2)'))).toBe('measure');
    expect(classifyColumn(col('qty', 'BIGINT'))).toBe('measure');
    expect(classifyColumn(col('created_at', 'TIMESTAMP WITH TIME ZONE'))).toBe('time');
    expect(classifyColumn(col('day', 'DATE'))).toBe('time');
    expect(classifyColumn(col('status', 'VARCHAR(32)'))).toBe('dimension');
    expect(classifyColumn(col('active', 'BOOLEAN'))).toBe('dimension');
  });

  it('treats id-like columns as ids regardless of type', () => {
    expect(classifyColumn(col('id', 'INTEGER', 'numeric'))).toBe('id');
    expect(classifyColumn(col('customer_id', 'INTEGER', 'numeric'))).toBe('id');
    expect(classifyColumn(col('session_key', 'VARCHAR'))).toBe('id');
    expect(classifyColumn(col('uuid', 'VARCHAR'))).toBe('id');
    // NOT id-like: merely ends in "id" without a separator
    expect(classifyColumn(col('paid', 'BOOLEAN'))).toBe('dimension');
  });
});

describe('deriveSemanticModels — vocabulary', () => {
  const models = () => deriveSemanticModels([ORDERS]);

  it('derives one model per table with columns', () => {
    const m = models();
    expect(m).toHaveLength(2);
    expect(modelFor(m, 'orders')).toMatchObject({
      name: 'Orders',
      connection: 'warehouse',
      primary: { kind: 'table', schema: 'public', table: 'orders' },
    });
  });

  it('categorical/text columns become dimensions; ids become dimensions too', () => {
    const orders = modelFor(models(), 'orders');
    const dimCols = orders.dimensions.filter((d) => d.source === 'primary').map((d) => d.column);
    expect(dimCols).toContain('status');
    expect(dimCols).toContain('id');
    expect(dimCols).toContain('customer_id');
    // plain numerics are NOT dimensions
    expect(dimCols).not.toContain('amount');
  });

  it('temporal columns are dimensions and the created_at-style one wins timeDimension', () => {
    const orders = modelFor(models(), 'orders');
    expect(orders.timeDimension?.column).toBe('created_at');
    const dimCols = orders.dimensions.map((d) => d.column);
    expect(dimCols).toContain('created_at');
    expect(dimCols).toContain('shipped_date');
    // customers has a single temporal column — it just wins
    expect(modelFor(models(), 'customers').timeDimension?.column).toBe('signup_date');
  });

  it('a categorical-profiled numeric is BOTH: measures + a groupable dimension', () => {
    const db2 = db('warehouse', {
      spend: [
        col('clicks', 'BIGINT', 'categorical'),
        col('amount', 'DOUBLE', 'numeric'),
      ],
    });
    const m = modelFor(deriveSemanticModels([db2]), 'spend');
    expect(m.measures.map((me) => me.name)).toEqual(expect.arrayContaining(['Total Clicks', 'Avg Clicks']));
    expect(m.dimensions.map((d) => d.column)).toContain('clicks');  // profiled groupable
    expect(m.dimensions.map((d) => d.column)).not.toContain('amount'); // plain numeric: measure only
  });

  it('numeric columns derive Total/Avg measures; ids derive Unique; Count always exists', () => {
    const orders = modelFor(models(), 'orders');
    const byName = new Map(orders.measures.map((me) => [me.name, me]));
    expect(byName.get('Count')).toMatchObject({ agg: 'COUNT' });
    expect(byName.get('Count')?.column).toBeUndefined();
    expect(byName.get('Total Amount')).toMatchObject({ agg: 'SUM', column: 'amount' });
    expect(byName.get('Avg Amount')).toMatchObject({ agg: 'AVG', column: 'amount' });
    expect(byName.get('Total Discount')).toMatchObject({ agg: 'SUM', column: 'discount' });
    expect(byName.get('Unique Customer')).toMatchObject({ agg: 'COUNT_DISTINCT', column: 'customer_id' });
    // id columns never SUM
    expect([...byName.values()].some((me) => me.agg === 'SUM' && me.column === 'customer_id')).toBe(false);
  });

  it('derived drafts never carry references — joins are authored, not derived', () => {
    for (const m of models()) {
      expect(m.references ?? []).toEqual([]);
    }
  });

  it('disambiguates duplicate table names across schemas', () => {
    const twoSchemas: DatabaseWithSchema = {
      databaseName: 'warehouse',
      schemas: [
        { schema: 'prod', tables: [{ table: 'events', columns: [col('kind', 'VARCHAR', 'categorical')] }] },
        { schema: 'staging', tables: [{ table: 'events', columns: [col('kind', 'VARCHAR', 'categorical')] }] },
      ],
    };
    const names = deriveSemanticModels([twoSchemas]).map((m) => m.name).sort();
    expect(names).toEqual(['Events (prod)', 'Events (staging)']);
  });
});

describe('deriveModelStubs — global naming over names-only schemas', () => {
  const NAMES_ONLY: DatabaseWithSchema = {
    databaseName: 'warehouse',
    schemas: [
      { schema: 'prod', tables: [{ table: 'events', columns: [] }, { table: 'orders', columns: [] }] },
      { schema: 'staging', tables: [{ table: 'events', columns: [] }] },
    ],
  };

  it('same-humanization collisions WITHIN one schema still get unique names', () => {
    const oneSchema: DatabaseWithSchema = {
      databaseName: 'warehouse',
      schemas: [{ schema: 'habuild', tables: [
        { table: 'cid_72', columns: [] },
        { table: 'CID-72', columns: [] },
        { table: 'Cid 72', columns: [] },
      ]}],
    };
    const names = deriveModelStubs([oneSchema]).map((st) => st.name);
    expect(new Set(names).size).toBe(3); // strictly unique — they become React keys and spec references
    for (const st of deriveModelStubs([oneSchema])) {
      expect(st.name).toContain('Cid 72');
    }
  });

  it('produces one stub per table (columns not required) with disambiguated names', () => {
    const stubs = deriveModelStubs([NAMES_ONLY]);
    expect(stubs.map((st) => st.name).sort()).toEqual(['Events (prod)', 'Events (staging)', 'Orders']);
    expect(stubs.find((st) => st.name === 'Orders')).toMatchObject({ connection: 'warehouse', schema: 'prod', table: 'orders' });
  });

  it('scoped derivation names match global stub names via namingDatabases', () => {
    const scoped: DatabaseWithSchema = {
      databaseName: 'warehouse',
      schemas: [{ schema: 'prod', tables: [{ table: 'events', columns: [col('kind', 'VARCHAR', 'categorical')] }] }],
    };
    const models = deriveSemanticModels([scoped], [NAMES_ONLY]);
    expect(models).toHaveLength(1);
    expect(models[0].name).toBe('Events (prod)'); // not plain "Events" — global naming wins
  });
});

describe('end-to-end: SQL against a derived model detects as semantic', () => {
  const models = () => deriveSemanticModels([ORDERS]);

  it('grouped aggregate over base dims round-trips (postgres)', async () => {
    const spec = await detectSemanticQuery(
      `SELECT o.status, SUM(o.amount), COUNT(*)
         FROM public.orders o
        GROUP BY o.status`,
      models(),
      'postgres',
    );
    expect(spec).toMatchObject({
      model: 'Orders',
      dimensions: ['Status'],
      measures: expect.arrayContaining(['Total Amount', 'Count']),
    });
  });

  it('time-grain query maps onto the derived timeDimension (bigquery)', async () => {
    const spec = await detectSemanticQuery(
      `SELECT DATE_TRUNC(created_at, MONTH), AVG(amount) FROM public.orders GROUP BY 1`,
      models(),
      'bigquery',
    );
    expect(spec).toMatchObject({ model: 'Orders', timeGrain: 'MONTH', measures: ['Avg Amount'] });
  });

  it('refuses SQL outside the derived vocabulary (window function)', async () => {
    const spec = await detectSemanticQuery(
      `SELECT status, ROW_NUMBER() OVER (ORDER BY amount) FROM public.orders`,
      models(),
      'postgres',
    );
    expect(spec).toBeNull();
  });
});
