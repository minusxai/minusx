/**
 * Derived semantic models — schema + declared relationships → SemanticModel[],
 * with no authored model config. Ends with an end-to-end proof: SQL written
 * against a derived model detects back into a semantic spec.
 */
import { describe, it, expect } from 'vitest';
import { deriveSemanticModels, deriveModelStubs, classifyColumn, humanizeName, validateTableRelationships } from '../derive';
import { detectSemanticQuery } from '../detect-sql';
import type { DatabaseWithSchema, SemanticModel, TableRelationship } from '@/lib/types';

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

const ORDERS_REL: TableRelationship[] = [{
  connection: 'warehouse',
  schema: 'public',
  table: 'orders',
  column: 'customer_id',
  targetSchema: 'public',
  targetTable: 'customers',
  targetColumn: 'id',
  relationship: 'many_to_one',
}];

const modelFor = (models: SemanticModel[], table: string) => {
  const m = models.find((x) => x.table === table);
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
    expect(classifyColumn(col('amount', 'VARCHAR', 'numeric'))).toBe('measure'); // meta wins over type
    expect(classifyColumn(col('created_at', 'VARCHAR', 'temporal'))).toBe('time');
    expect(classifyColumn(col('notes', 'DOUBLE', 'text'))).toBe('dimension');
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
  const models = () => deriveSemanticModels([ORDERS], ORDERS_REL);

  it('derives one model per table with columns', () => {
    const m = models();
    expect(m).toHaveLength(2);
    expect(modelFor(m, 'orders')).toMatchObject({ name: 'Orders', connection: 'warehouse', schema: 'public' });
  });

  it('categorical/text columns become dimensions; ids become dimensions too', () => {
    const orders = modelFor(models(), 'orders');
    const dimCols = orders.dimensions.filter((d) => !d.join).map((d) => d.column);
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

  it('declared relationships become LEFT lookup joins with the target dims join-qualified', () => {
    const orders = modelFor(models(), 'orders');
    expect(orders.joins).toEqual([{
      table: 'customers',
      schema: 'public',
      alias: 'customers',
      type: 'LEFT',
      relationship: 'many_to_one',
      leftColumn: 'customer_id',
      rightColumn: 'id',
    }]);
    const joined = orders.dimensions.filter((d) => d.join === 'customers');
    expect(joined.map((d) => d.column)).toEqual(expect.arrayContaining(['name', 'segment']));
    expect(joined.find((d) => d.column === 'segment')?.name).toBe('Customers Segment');
    // the lookup's own model has no joins (relationship is declared on orders)
    expect(modelFor(models(), 'customers').joins ?? []).toEqual([]);
  });

  it('relationship scoping: only the owning table gets the join', () => {
    const rels: TableRelationship[] = [{ ...ORDERS_REL[0], table: 'nonexistent' }];
    const m = deriveSemanticModels([ORDERS], rels);
    expect(modelFor(m, 'orders').joins ?? []).toEqual([]);
  });

  it('disambiguates duplicate table names across schemas', () => {
    const twoSchemas: DatabaseWithSchema = {
      databaseName: 'warehouse',
      schemas: [
        { schema: 'prod', tables: [{ table: 'events', columns: [col('kind', 'VARCHAR', 'categorical')] }] },
        { schema: 'staging', tables: [{ table: 'events', columns: [col('kind', 'VARCHAR', 'categorical')] }] },
      ],
    };
    const names = deriveSemanticModels([twoSchemas], []).map((m) => m.name).sort();
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
    const models = deriveSemanticModels([scoped], [], [NAMES_ONLY]);
    expect(models).toHaveLength(1);
    expect(models[0].name).toBe('Events (prod)'); // not plain "Events" — global naming wins
  });
});

describe('validateTableRelationships', () => {
  const base = ORDERS_REL[0];
  it('accepts a complete relationship and empty/undefined lists', () => {
    expect(validateTableRelationships([base])).toEqual([]);
    expect(validateTableRelationships([])).toEqual([]);
    expect(validateTableRelationships(undefined)).toEqual([]);
  });
  it('flags missing fields and bad cardinality', () => {
    expect(validateTableRelationships([{ ...base, column: '' }]).length).toBeGreaterThan(0);
    expect(validateTableRelationships([{ ...base, targetTable: '' }]).length).toBeGreaterThan(0);
    expect(validateTableRelationships([{ ...base, relationship: 'one_to_many' as never }]).length).toBeGreaterThan(0);
  });
  it('flags a self-join to the same column', () => {
    expect(validateTableRelationships([{ ...base, targetTable: 'orders', targetColumn: 'customer_id' }]).length).toBeGreaterThan(0);
  });
});

describe('end-to-end: SQL against a derived model detects as semantic', () => {
  const models = () => deriveSemanticModels([ORDERS], ORDERS_REL);

  it('grouped aggregate over base + lookup dims round-trips (postgres)', async () => {
    const spec = await detectSemanticQuery(
      `SELECT c.segment, o.status, SUM(o.amount), COUNT(*)
         FROM public.orders o
         LEFT JOIN public.customers c ON o.customer_id = c.id
        GROUP BY c.segment, o.status`,
      models(),
      'postgres',
    );
    expect(spec).toMatchObject({
      model: 'Orders',
      dimensions: expect.arrayContaining(['Customers Segment', 'Status']),
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
