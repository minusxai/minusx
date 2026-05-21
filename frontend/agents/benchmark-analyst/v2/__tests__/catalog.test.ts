// Tests for buildCatalog: creates the 6 synthetic catalog tables from connection schemas
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fauxAssistantMessage, registerFauxProvider } from '@/orchestrator/llm/testing';
import type { SchemaEntry, NodeConnector, QueryResult } from '@/lib/connections/base';
import type { ConnectionInfo } from '../../types';
import {
  buildCatalog,
  getCatalogStore,
  clearCatalogCache,
  type CatalogTables,
  type CatalogConnector,
} from '../catalog';

const fauxReg = registerFauxProvider({
  api: 'faux-catalog-api',
  provider: 'faux-catalog',
  models: [{ id: 'stub-catalog' }],
});
const stubModel = fauxReg.getModel();

const mockEntry = (
  name: string,
  schema: SchemaEntry[],
  dialect = 'duckdb',
): CatalogConnector => ({
  connector: ({
    name,
    getSchema: vi.fn(async () => schema),
    query: vi.fn(async () => ({ columns: [], types: [], rows: [], finalQuery: '' })),
  }) as unknown as NodeConnector,
  dialect,
});

const SIMPLE_SCHEMA: SchemaEntry[] = [
  {
    schema: 'public',
    tables: [
      {
        table: 'users',
        columns: [
          { name: 'id', type: 'INTEGER', meta: { category: 'numeric' } },
          { name: 'email', type: 'VARCHAR', meta: { category: 'text', nDistinct: 1000 } },
          { name: 'status', type: 'VARCHAR', meta: { category: 'categorical', nDistinct: 3, topValues: [{ value: 'active', count: 800, fraction: 0.8 }] } },
        ],
        indexes: [
          { name: 'users_pkey', columns: ['id'], unique: true },
          { name: 'users_email_idx', columns: ['email'], unique: true },
        ],
      },
      {
        table: 'orders',
        columns: [
          { name: 'id', type: 'INTEGER', meta: { category: 'numeric' } },
          { name: 'user_id', type: 'INTEGER', meta: { category: 'numeric' } },
          { name: 'amount', type: 'DECIMAL', meta: { category: 'numeric', min: 10, max: 1000 } },
        ],
      },
    ],
  },
];

describe('buildCatalog', () => {
  describe('table structure', () => {
    it('produces all 6 catalog tables', async () => {
      const connectors = new Map([['db1', mockEntry('db1', SIMPLE_SCHEMA)]]);

      const catalog = await buildCatalog(connectors);

      expect(catalog.connections).toBeDefined();
      expect(catalog.schemas).toBeDefined();
      expect(catalog.tables).toBeDefined();
      expect(catalog.columns).toBeDefined();
      expect(catalog.indexes).toBeDefined();
      expect(catalog.column_stats).toBeDefined();
    });

    it('connections table has one row per connector', async () => {
      const connectors = new Map([
        ['db1', mockEntry('db1', SIMPLE_SCHEMA)],
        ['db2', mockEntry('db2', [])],
      ]);

      const catalog = await buildCatalog(connectors);

      expect(catalog.connections.rows).toHaveLength(2);
      expect(catalog.connections.rows.map((r) => r.connection_name)).toEqual(['db1', 'db2']);
    });

    it('schemas table has one row per schema across all connections', async () => {
      const schema2: SchemaEntry[] = [{ schema: 'analytics', tables: [] }];
      const connectors = new Map([
        ['db1', mockEntry('db1', SIMPLE_SCHEMA)],
        ['db2', mockEntry('db2', schema2)],
      ]);

      const catalog = await buildCatalog(connectors);

      expect(catalog.schemas.rows).toHaveLength(2);
      expect(catalog.schemas.rows.map((r) => r.schema_name)).toContain('public');
      expect(catalog.schemas.rows.map((r) => r.schema_name)).toContain('analytics');
    });

    it('tables table has one row per table with row_count if available', async () => {
      const connectors = new Map([['db1', mockEntry('db1', SIMPLE_SCHEMA)]]);

      const catalog = await buildCatalog(connectors);

      expect(catalog.tables.rows).toHaveLength(2);
      const userTable = catalog.tables.rows.find((r) => r.table_name === 'users');
      expect(userTable?.connection_name).toBe('db1');
      expect(userTable?.schema_name).toBe('public');
    });

    it('columns table has one row per column with type', async () => {
      const connectors = new Map([['db1', mockEntry('db1', SIMPLE_SCHEMA)]]);

      const catalog = await buildCatalog(connectors);

      const userColumns = catalog.columns.rows.filter(
        (r) => r.table_name === 'users',
      );
      expect(userColumns).toHaveLength(3);
      expect(userColumns.map((c) => c.column_name)).toEqual(['id', 'email', 'status']);
    });

    it('indexes table has one row per index', async () => {
      const connectors = new Map([['db1', mockEntry('db1', SIMPLE_SCHEMA)]]);

      const catalog = await buildCatalog(connectors);

      expect(catalog.indexes.rows).toHaveLength(2);
      const pkeyIdx = catalog.indexes.rows.find((r) => r.index_name === 'users_pkey');
      expect(pkeyIdx?.columns).toBe('id');
      expect(pkeyIdx?.is_unique).toBe(true);
    });

    it('column_stats table contains stats from column meta', async () => {
      const connectors = new Map([['db1', mockEntry('db1', SIMPLE_SCHEMA)]]);

      const catalog = await buildCatalog(connectors);

      const amountStats = catalog.column_stats.rows.find(
        (r) => r.column_name === 'amount',
      );
      expect(amountStats?.min_value).toBe(10);
      expect(amountStats?.max_value).toBe(1000);

      const statusStats = catalog.column_stats.rows.find(
        (r) => r.column_name === 'status',
      );
      expect(statusStats?.n_distinct).toBe(3);
      expect(statusStats?.category).toBe('categorical');
    });
  });

  describe('profileDatabase integration', () => {
    it('enriches schema with stats via profileDatabase if not already enriched', async () => {
      const bareSchema: SchemaEntry[] = [
        {
          schema: 'main',
          tables: [
            {
              table: 'products',
              columns: [
                { name: 'id', type: 'INTEGER' },
                { name: 'name', type: 'VARCHAR' },
              ],
            },
          ],
        },
      ];

      const connector = {
        name: 'bare_db',
        getSchema: vi.fn(async () => bareSchema),
        query: vi.fn(async (sql: string): Promise<QueryResult> => {
          if (sql.includes('SUMMARIZE')) {
            return {
              columns: ['column_name', 'min', 'max', 'approx_unique'],
              types: ['VARCHAR', 'VARCHAR', 'VARCHAR', 'BIGINT'],
              rows: [
                { column_name: 'id', min: '1', max: '100', approx_unique: 100 },
                { column_name: 'name', min: 'A', max: 'Z', approx_unique: 50 },
              ],
              finalQuery: '',
            };
          }
          return { columns: [], types: [], rows: [], finalQuery: '' };
        }),
      } as unknown as NodeConnector;

      const connectors = new Map<string, CatalogConnector>([
        ['bare_db', { connector, dialect: 'duckdb' }],
      ]);

      const catalog = await buildCatalog(connectors);

      expect(catalog.column_stats.rows.length).toBeGreaterThan(0);
    });

    it('uses the connection dialect for profiling — mongo uses a native $sample pipeline, never SQL', async () => {
      const bareSchema: SchemaEntry[] = [
        {
          schema: 'main',
          tables: [{ table: 'docs', columns: [{ name: 'id', type: 'INTEGER' }] }],
        },
      ];
      const query = vi.fn(async () => ({ columns: [], types: [], rows: [], finalQuery: '' }));
      const connector = {
        name: 'mongo_db',
        getSchema: vi.fn(async () => bareSchema),
        query,
      } as unknown as NodeConnector;

      // dialect 'mongo' → profileMongo issues one $sample aggregation pipeline
      // per collection. No SQL must appear on the mongo connector.
      const connectors = new Map<string, CatalogConnector>([
        ['mongo_db', { connector, dialect: 'mongo' }],
      ]);
      await buildCatalog(connectors);

      expect(query).toHaveBeenCalledTimes(1);
      const arg = (query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      const parsed = JSON.parse(arg);
      expect(parsed.collection).toBe('docs');
      expect(parsed.pipeline[0].$sample).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('handles empty connectors map', async () => {
      const catalog = await buildCatalog(new Map());

      expect(catalog.connections.rows).toHaveLength(0);
      expect(catalog.schemas.rows).toHaveLength(0);
      expect(catalog.tables.rows).toHaveLength(0);
    });

    it('handles connector with empty schema', async () => {
      const connectors = new Map([['empty', mockEntry('empty', [])]]);

      const catalog = await buildCatalog(connectors);

      expect(catalog.connections.rows).toHaveLength(1);
      expect(catalog.schemas.rows).toHaveLength(0);
      expect(catalog.tables.rows).toHaveLength(0);
    });

    it('handles tables without indexes', async () => {
      const schemaNoIndexes: SchemaEntry[] = [
        {
          schema: 'public',
          tables: [
            { table: 'simple', columns: [{ name: 'id', type: 'INT' }] },
          ],
        },
      ];
      const connectors = new Map([['db', mockEntry('db', schemaNoIndexes)]]);

      const catalog = await buildCatalog(connectors);

      expect(catalog.indexes.rows).toHaveLength(0);
    });
  });
});

// `getCatalogStore` owns the cache + DuckDB-instance lifecycle. The keyed
// cache lets DoubleCheck sub-agents share the same catalog *contents* but
// hold independent stores — needed so per-slot sample tables (next step)
// can differ without per-query filtering. Tested directly here so the
// per-key semantics are pinned regardless of which tool calls in.
describe('getCatalogStore — keyed cache', () => {
  beforeEach(() => {
    clearCatalogCache();
  });
  afterEach(() => {
    clearCatalogCache();
  });

  it('returns the same store for the same key (cache hit)', async () => {
    const a1 = await getCatalogStore(undefined, 'agent-a');
    const a2 = await getCatalogStore(undefined, 'agent-a');
    expect(a2.conn).toBe(a1.conn);
  });

  it('returns different stores for different keys (independent DuckDB connections)', async () => {
    const a = await getCatalogStore(undefined, 'agent-a');
    const b = await getCatalogStore(undefined, 'agent-b');
    expect(b.conn).not.toBe(a.conn);
  });

  it("defaults to the 'default' key when none is passed", async () => {
    const implicit = await getCatalogStore(undefined);
    const explicit = await getCatalogStore(undefined, 'default');
    expect(implicit.conn).toBe(explicit.conn);
  });

  it("'default' is its own slot — distinct from 'agent-a' / 'agent-b'", async () => {
    const def = await getCatalogStore(undefined);
    const a = await getCatalogStore(undefined, 'agent-a');
    expect(a.conn).not.toBe(def.conn);
  });

  it('clearCatalogCache drops every key', async () => {
    const before = await getCatalogStore(undefined, 'agent-a');
    clearCatalogCache();
    const after = await getCatalogStore(undefined, 'agent-a');
    expect(after.conn).not.toBe(before.conn);
  });

  // sampleConfig flowing through getCatalogStore → buildCatalog is verified
  // indirectly: the buildCatalog tests above cover the sample-build behavior,
  // and the tools' integration tests (search-db-schema / explore) exercise
  // getCatalogStore end-to-end against mocked connectors. A direct
  // getCatalogStore-with-real-config test would need a real source DB file
  // (not worth the test infra).
});

// sample_rows / sample_notes: 100 random rows per table are pulled via
// `connector.query(buildSampleSql(...))`, then a lighter-model pass picks
// 10 diverse/representative rows and writes a free-text shape note. The
// agent's `SearchDBSchema` reads both tables during orientation — saving
// 10+ exploratory data queries per question (e.g. the yelp-parking thrash).
describe('buildCatalog — sample_rows + sample_notes', () => {
  // Helper: a connector returning a fixed schema for getSchema() and a
  // 100-row pool for any query() call. The lighter-model mock is passed
  // in per-test.
  function poolConnector(
    schema: SchemaEntry[],
    poolPerTable: Record<string, Record<string, unknown>[]>,
    poolColumns: Record<string, string[]>,
  ): NodeConnector {
    return {
      getSchema: vi.fn(async () => schema),
      query: vi.fn(async (sql: string) => {
        // Cheap routing: the sample SQL contains the table name in quotes;
        // pick that table's pool. Falls back to the first table.
        const tables = Object.keys(poolPerTable);
        const matched = tables.find((t) => sql.includes(`"${t}"`)) ?? tables[0];
        return {
          columns: poolColumns[matched] ?? [],
          types: (poolColumns[matched] ?? []).map(() => 'VARCHAR'),
          rows: poolPerTable[matched] ?? [],
          finalQuery: sql,
        };
      }),
    } as unknown as NodeConnector;
  }

  // Helper: callLLM mock that returns the same picks + info for every
  // table. Returns 10 rerankedIds (r0..r9) by default.
  function makeCallLLM(info: string, rerankedIds: string[] = ['r0','r1','r2','r3','r4','r5','r6','r7','r8','r9']) {
    // Typed so test assertions can read `.mock.calls[i][1]` (the `ctx` arg).
    return vi.fn(async (..._args: unknown[]) =>
      fauxAssistantMessage(
        JSON.stringify({ results: [{ rerankedIds }], info }),
        { stopReason: 'stop' },
      ),
    );
  }

  it('builds sample_rows from connector samples picked by the lighter model', async () => {
    const pool = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `row${i}` }));
    const connector = poolConnector(
      SIMPLE_SCHEMA,
      { users: pool, orders: pool },
      { users: ['id', 'name'], orders: ['id', 'name'] },
    );
    const connectors = new Map([['db1', { connector, dialect: 'duckdb' } as CatalogConnector]]);
    const callLLM = makeCallLLM('Shape note for table');

    const catalog = await buildCatalog(connectors, {
      slotPrompt: 'pick 10 representative rows; in info, describe the shape',
      callLLM,
      model: stubModel,
    });

    expect(catalog.sample_rows).toBeDefined();
    // 2 tables × 10 picks = 20 sample rows total
    expect(catalog.sample_rows.rows).toHaveLength(20);
    // Each row has the expected catalog metadata + row_json blob
    const first = catalog.sample_rows.rows[0];
    expect(first.connection_name).toBe('db1');
    expect(first.table_name).toBeDefined();
    expect(first.row_json).toBeDefined();
    expect(typeof first.row_json).toBe('string');
    // Sanity: row_json parses back to the original row shape
    expect(typeof JSON.parse(first.row_json as string)).toBe('object');
  });

  it('builds sample_notes with one shape note per table', async () => {
    const pool = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `row${i}` }));
    const connector = poolConnector(
      SIMPLE_SCHEMA,
      { users: pool, orders: pool },
      { users: ['id', 'name'], orders: ['id', 'name'] },
    );
    const connectors = new Map([['db1', { connector, dialect: 'duckdb' } as CatalogConnector]]);
    const callLLM = makeCallLLM('Stored as JSON-encoded blobs with id field');

    const catalog = await buildCatalog(connectors, {
      slotPrompt: 'representative',
      callLLM,
      model: stubModel,
    });

    expect(catalog.sample_notes).toBeDefined();
    // 2 tables × 1 note each = 2 sample_notes rows
    expect(catalog.sample_notes.rows).toHaveLength(2);
    const note = catalog.sample_notes.rows[0];
    expect(note.connection_name).toBe('db1');
    expect(note.table_name).toBeDefined();
    expect(note.notes).toBe('Stored as JSON-encoded blobs with id field');
  });

  it('passes the slotPrompt verbatim into the lighter-model call (slot steering)', async () => {
    const pool = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const connector = poolConnector(
      [{ schema: 'public', tables: [{ table: 'users', columns: [{ name: 'id', type: 'INT' }] }] }],
      { users: pool },
      { users: ['id'] },
    );
    const connectors = new Map([['db1', { connector, dialect: 'duckdb' } as CatalogConnector]]);
    const callLLM = makeCallLLM('shape');

    await buildCatalog(connectors, {
      slotPrompt: 'EDGE-CASE-PROMPT: pick rare variants',
      callLLM,
      model: stubModel,
    });

    expect(callLLM).toHaveBeenCalled();
    const passedCtx = callLLM.mock.calls[0][1] as { messages: Array<{ content: string }> };
    expect(passedCtx.messages[0].content).toContain('EDGE-CASE-PROMPT: pick rare variants');
  });

  it('skips a table gracefully when the sample query fails (catalog still builds)', async () => {
    const schema: SchemaEntry[] = [
      { schema: 'public', tables: [
        { table: 'good', columns: [{ name: 'id', type: 'INT' }] },
        { table: 'bad',  columns: [{ name: 'id', type: 'INT' }] },
      ] },
    ];
    const goodPool = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const connector = {
      getSchema: vi.fn(async () => schema),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('"bad"')) throw new Error('connector blew up');
        return { columns: ['id'], types: ['INT'], rows: goodPool, finalQuery: sql };
      }),
    } as unknown as NodeConnector;
    const connectors = new Map([['db1', { connector, dialect: 'duckdb' } as CatalogConnector]]);
    const callLLM = makeCallLLM('shape');

    const catalog = await buildCatalog(connectors, {
      slotPrompt: 'representative', callLLM, model: stubModel,
    });

    // The good table still has 10 picks; the bad table is silently skipped.
    expect(catalog.sample_rows.rows.length).toBe(10);
    expect((catalog.sample_rows.rows[0] as { table_name: string }).table_name).toBe('good');
  });

  it('does not build sample tables when no sampleConfig is given (backwards-compat)', async () => {
    const connectors = new Map([['db1', mockEntry('db1', SIMPLE_SCHEMA)]]);
    const catalog = await buildCatalog(connectors);
    // sample_rows / sample_notes always present (interface invariant) but empty
    expect(catalog.sample_rows.rows).toHaveLength(0);
    expect(catalog.sample_notes.rows).toHaveLength(0);
  });
});
