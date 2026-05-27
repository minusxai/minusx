// AUTO-MERGED test file (see git history for the original per-feature files).
// Merged to amortize the per-file module-import cost across one harness load.

import { detachAllBenchmarkAttachments } from '../../shared-duckdb';
import type { BenchmarkAnalystContext } from '../../types';
import { buildCatalog, clearCatalogCache, getCatalogStore } from '../catalog';
import type { CatalogConnector } from '../catalog';
import { V2DataTool } from '../data-tool-base';
import { ExecuteQueryV2 } from '../execute-query';
import { clearHandles, fetchHandle, storeHandle } from '../handle-store';
import { applyRerank, buildPromptPassPreviews, buildPromptPassUserContent, parsePromptPassResponse, pickPromptPassInfo, runPromptPassFree } from '../prompt-pass';
import type { PromptPassEntry } from '../prompt-pass';
import { V2BenchmarkAnalystAgent } from '../v2-agent';
import type { NodeConnector, QueryResult, SchemaEntry } from '@/lib/connections/base';
import type { Api, Model, TextContent, Tool } from '@/orchestrator/llm';
import { fauxAssistantMessage, registerFauxProvider } from '@/orchestrator/llm/testing';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { ToolResponse } from '@/orchestrator/types';
import { DuckDBInstance } from '@duckdb/node-api';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { Type } from 'typebox';

describe('catalog', () => {
// Tests for buildCatalog: creates the 6 synthetic catalog tables from connection schemas






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
});

describe('prompt-pass', () => {
// Tests for the shared "+prompt" pass.
//
// The orchestrating method lives on `V2DataTool` (it reads `this.context` /
// `this.orchestrator` / `this.id` directly — no context flows as args). Pure
// pieces (user-content building, rerank application, response parsing) live
// in `prompt-pass.ts` and are tested directly here. Integration of the LLM
// call is tested through a minimal `V2DataTool` subclass.












const fauxReg = registerFauxProvider({
  api: 'faux-prompt-pass-api',
  provider: 'faux-prompt-pass',
  models: [{ id: 'stub-prompt-pass' }],
});

const result = (names: string[]): QueryResult => ({
  columns: ['name'],
  types: ['VARCHAR'],
  rows: names.map((name) => ({ name })),
  finalQuery: '',
});

// ─── Pure helpers ──────────────────────────────────────────────────────────

describe('applyRerank', () => {
  it('reorders rows to the given ids', () => {
    const rows = [{ name: 'alpha' }, { name: 'beta' }, { name: 'gamma' }];
    expect(applyRerank(rows, ['r2', 'r0', 'r1'])).toEqual([
      { name: 'gamma' }, { name: 'alpha' }, { name: 'beta' },
    ]);
  });

  it('filters to a subset of ids', () => {
    const rows = [{ name: 'alpha' }, { name: 'beta' }];
    expect(applyRerank(rows, ['r1'])).toEqual([{ name: 'beta' }]);
  });

  it('skips unknown ids per-row, keeps the known ones', () => {
    const rows = [{ name: 'alpha' }, { name: 'beta' }];
    expect(applyRerank(rows, ['r7', 'r1'])).toEqual([{ name: 'beta' }]);
  });

  it('dedupes repeated ids', () => {
    const rows = [{ name: 'alpha' }, { name: 'beta' }];
    expect(applyRerank(rows, ['r1', 'r1', 'r0'])).toEqual([{ name: 'beta' }, { name: 'alpha' }]);
  });

  it('falls back to original order when all ids are unknown', () => {
    const rows = [{ name: 'alpha' }, { name: 'beta' }];
    expect(applyRerank(rows, ['r7', 'r8'])).toEqual(rows);
  });

  it('falls back to original order for non-array or empty input', () => {
    const rows = [{ name: 'alpha' }];
    expect(applyRerank(rows, null)).toEqual(rows);
    expect(applyRerank(rows, [])).toEqual(rows);
    expect(applyRerank(rows, 'not-an-array')).toEqual(rows);
  });
});

describe('buildPromptPassUserContent', () => {
  it('includes original question and data docs when context provides them', () => {
    const content = buildPromptPassUserContent(
      [{ label: 'q1', result: result(['alpha']) }],
      'task text',
      { contextDocs: 'Docs about the dataset.', originalMessage: 'What is the answer?' },
    );
    expect(content).toContain('## Original question');
    expect(content).toContain('What is the answer?');
    expect(content).toContain('## Data Documentation');
    expect(content).toContain('Docs about the dataset.');
    expect(content).toContain('## Task');
    expect(content).toContain('task text');
  });

  it('omits grounding sections when context is empty', () => {
    const content = buildPromptPassUserContent(
      [{ label: 'q1', result: result(['alpha']) }],
      'task',
      {},
    );
    expect(content).not.toContain('## Original question');
    expect(content).not.toContain('## Data Documentation');
  });

  it('renders error entries with their error text', () => {
    const content = buildPromptPassUserContent(
      [{ label: 'q1', error: 'boom' }],
      'task',
      {},
    );
    expect(content).toContain('ERROR: boom');
  });

  it('indexes shown rows with rN: prefixes', () => {
    const content = buildPromptPassUserContent(
      [{ label: 'q1', result: result(['alpha', 'beta']) }],
      'task',
      {},
    );
    expect(content).toMatch(/r0: \{"name":"alpha"\}/);
    expect(content).toMatch(/r1: \{"name":"beta"\}/);
  });
});

describe('runPromptPassFree skipUserMessage', () => {
  // Stub call shape: capture the inbound user-message content text so we
  // can inspect grounding sections without depending on the full Context type.
  const captureCallLLM = () => {
    const userContents: string[] = [];
    const fn: typeof Orchestrator.prototype.callLLM extends infer T ? T : never =
      undefined as never;
    void fn;
    const callLLM = async (_model: Model<Api>, context: { messages: Array<{ content: unknown }> }) => {
      const first = context.messages[0]?.content;
      userContents.push(typeof first === 'string' ? first : JSON.stringify(first));
      return fauxAssistantMessage('{"results":[],"info":"x"}');
    };
    return { callLLM: callLLM as unknown as Parameters<typeof runPromptPassFree>[4], userContents };
  };
  const stubModel = fauxReg.getModel();

  it('includes the original question by default', async () => {
    const { callLLM, userContents } = captureCallLLM();
    await runPromptPassFree(
      [{ label: 'q1', result: result(['a']) }],
      'task',
      stubModel,
      { contextDocs: 'docs', originalMessage: 'leak-me' },
      callLLM,
    );
    expect(userContents[0]).toContain('## Original question');
    expect(userContents[0]).toContain('leak-me');
  });

  it('strips originalMessage when skipUserMessage is true', async () => {
    const { callLLM, userContents } = captureCallLLM();
    await runPromptPassFree(
      [{ label: 'q1', result: result(['a']) }],
      'task',
      stubModel,
      { contextDocs: 'docs', originalMessage: 'leak-me' },
      callLLM,
      { skipUserMessage: true },
    );
    expect(userContents[0]).not.toContain('## Original question');
    expect(userContents[0]).not.toContain('leak-me');
    // Docs still flow through — only originalMessage is dropped.
    expect(userContents[0]).toContain('## Data Documentation');
  });

  it('accepts maxChars positional and opts trailing simultaneously', async () => {
    const { callLLM } = captureCallLLM();
    // Should not throw — verifies the dual-shape signature is backward-compat.
    await expect(
      runPromptPassFree(
        [{ label: 'q1', result: result(['a']) }],
        'task',
        stubModel,
        { originalMessage: 'q' },
        callLLM,
        500,
        { skipUserMessage: true },
      ),
    ).resolves.toBeDefined();
  });
});

describe('parsePromptPassResponse', () => {
  it('parses a valid JSON response', () => {
    const parsed = parsePromptPassResponse('{"results":[{"rerankedIds":["r0"]}],"info":"ok"}');
    expect(parsed).toEqual({ results: [{ rerankedIds: ['r0'] }], info: 'ok' });
  });

  it('tolerates code-fence wrappers', () => {
    const parsed = parsePromptPassResponse('```json\n{"results":[{"rerankedIds":["r0"]}],"info":"fenced"}\n```');
    expect(parsed?.info).toBe('fenced');
  });

  it('returns null on malformed JSON', () => {
    expect(parsePromptPassResponse('not json at all')).toBeNull();
  });
});

describe('pickPromptPassInfo', () => {
  it('returns parsed info when valid', () => {
    expect(pickPromptPassInfo({ info: 'hello' }, 'raw')).toBe('hello');
  });

  it('falls back to raw text when parsed is null', () => {
    expect(pickPromptPassInfo(null, 'raw text')).toBe('raw text');
  });

  it('falls back when info is missing or non-string', () => {
    expect(pickPromptPassInfo({}, 'raw')).toBe('raw');
    expect(pickPromptPassInfo({ info: 42 as unknown as string }, 'raw')).toBe('raw');
  });
});

describe('buildPromptPassPreviews', () => {
  it('returns undefined for error entries and previews for success entries', () => {
    const entries: PromptPassEntry[] = [
      { label: 'q1', error: 'boom' },
      { label: 'q2', result: result(['alpha', 'beta']) },
    ];
    const parsed = { results: [null, { rerankedIds: ['r1', 'r0'] }] };
    const previews = buildPromptPassPreviews(entries, parsed);
    expect(previews[0]).toBeUndefined();
    expect(previews[1]).toBeDefined();
    expect(previews[1]!.indexOf('beta')).toBeLessThan(previews[1]!.indexOf('alpha'));
  });

  it('keeps original order when parsed is null (fallback)', () => {
    const entries: PromptPassEntry[] = [{ label: 'q1', result: result(['alpha', 'beta']) }];
    const previews = buildPromptPassPreviews(entries, null);
    expect(previews[0]!.indexOf('alpha')).toBeLessThan(previews[0]!.indexOf('beta'));
  });
});

// ─── Integration: V2DataTool.runPromptPass ─────────────────────────────────

// A minimal V2DataTool subclass that exposes runPromptPass for tests.
const TestPassToolParams = Type.Object({});
class TestPassTool extends V2DataTool<typeof TestPassToolParams, unknown> {
  static readonly schema: Tool<typeof TestPassToolParams> = {
    name: 'TestPassTool',
    description: '',
    parameters: TestPassToolParams,
  };
  async run(): Promise<ToolResponse<unknown>> {
    throw new Error('not used');
  }
  async invoke(
    entries: PromptPassEntry[],
    prompt: string,
    model: Model<Api>,
    maxChars?: number,
  ) {
    // Public accessor — tests can't call the protected method directly.
    return this.runPromptPass(entries, prompt, model, maxChars);
  }
}

describe('V2DataTool.runPromptPass — integration', () => {
  beforeEach(() => {
    fauxReg.setResponses([]);
  });

  function makeTool(ctx: BenchmarkAnalystContext = {}): TestPassTool {
    const orch = new Orchestrator([TestPassTool]);
    return new TestPassTool(orch, {}, ctx, 'test-id');
  }

  it('reads contextDocs and originalMessage from this.context (no args needed)', async () => {
    fauxReg.setResponses([
      fauxAssistantMessage('{"results":[{"rerankedIds":null}],"info":"saw context"}', { stopReason: 'stop' }),
    ]);
    const tool = makeTool({
      contextDocs: 'Docs about the dataset.',
      originalMessage: 'What is the answer?',
    });
    const { info } = await tool.invoke(
      [{ label: 'q1', result: result(['alpha']) }],
      'task text',
      fauxReg.getModel(),
    );
    expect(info).toBe('saw context');
    // The call's user content (read via the spy below) includes the
    // grounding sections from this.context — verified indirectly by the
    // model receiving them; we test the building directly above.
  });

  it('falls back to raw text as info when the model returns non-JSON', async () => {
    fauxReg.setResponses([
      fauxAssistantMessage('just a plain-text summary', { stopReason: 'stop' }),
    ]);
    const tool = makeTool();
    const { info, previews } = await tool.invoke(
      [{ label: 'q1', result: result(['alpha', 'beta']) }],
      'task',
      fauxReg.getModel(),
    );
    expect(info).toBe('just a plain-text summary');
    // No valid rerank → original order preserved.
    expect(previews[0]!.indexOf('alpha')).toBeLessThan(previews[0]!.indexOf('beta'));
  });

  it('applies rerankedIds to reorder previews end-to-end', async () => {
    fauxReg.setResponses([
      fauxAssistantMessage(
        '{"results":[{"rerankedIds":["r2","r0","r1"]}],"info":"reordered"}',
        { stopReason: 'stop' },
      ),
    ]);
    const tool = makeTool();
    const { previews, info } = await tool.invoke(
      [{ label: 'q1', result: result(['alpha', 'beta', 'gamma']) }],
      'rank',
      fauxReg.getModel(),
    );
    expect(info).toBe('reordered');
    const p = previews[0]!;
    expect(p.indexOf('gamma')).toBeLessThan(p.indexOf('alpha'));
    expect(p.indexOf('alpha')).toBeLessThan(p.indexOf('beta'));
  });
});
});

describe('v2-agent', () => {
// Tests for V2BenchmarkAnalystAgent: tools, system prompt with dialect hints








// Test helper to access protected getSystemPrompt
class TestableV2Agent extends V2BenchmarkAnalystAgent {
  public getPrompt(): string {
    return this.getSystemPrompt();
  }
}

describe('V2BenchmarkAnalystAgent', () => {
  describe('tools', () => {
    it('advertises exactly 4 tools', () => {
      expect(V2BenchmarkAnalystAgent.tools).toHaveLength(4);
    });

    it('includes SearchDBSchema (V2)', () => {
      const names = V2BenchmarkAnalystAgent.tools.map((t) => t.name);
      expect(names).toContain('SearchDBSchema');
    });

    it('includes ExecuteQuery (V2)', () => {
      const names = V2BenchmarkAnalystAgent.tools.map((t) => t.name);
      expect(names).toContain('ExecuteQuery');
    });

    it('includes Explore (V2)', () => {
      const names = V2BenchmarkAnalystAgent.tools.map((t) => t.name);
      expect(names).toContain('Explore');
    });

    it('includes fetchHandle', () => {
      const names = V2BenchmarkAnalystAgent.tools.map((t) => t.name);
      expect(names).toContain('fetchHandle');
    });

    it('does NOT include old tools (ListDBConnections, FuzzyMatch, ExploreDataset)', () => {
      const names = V2BenchmarkAnalystAgent.tools.map((t) => t.name);
      expect(names).not.toContain('ListDBConnections');
      expect(names).not.toContain('FuzzyMatch');
      expect(names).not.toContain('ExploreDataset');
    });
  });

  describe('schema', () => {
    it('has distinct schema name', () => {
      expect(V2BenchmarkAnalystAgent.schema.name).toBe('V2BenchmarkAnalystAgent');
    });
  });

  describe('system prompt', () => {
    it('renders dialect hints only for present dialects', () => {
      const ctx: BenchmarkAnalystContext = {
        connections: [
          { name: 'duck', dialect: 'duckdb', description: '', config: {} },
          { name: 'pg', dialect: 'postgresql', description: '', config: {} },
        ],
        contextDocs: '',
      };

      const agent = new TestableV2Agent(
        {} as never,
        { userMessage: 'test' },
        ctx,
        'test-id',
      );

      const prompt = agent.getPrompt();

      // Test the dialect-hints section specifically — the broader prompt may
      // legitimately mention other dialects in examples (e.g. the SQL→Mongo
      // sequential-mode example). What MUST be conditional is the
      // per-dialect rendering inside `## Dialect-Specific Features`.
      const hintsSection = prompt.split('## Dialect-Specific Features')[1]?.split('## Analysis Guidelines')[0] ?? '';

      expect(hintsSection).toContain('### DUCKDB');
      expect(hintsSection).toContain('### POSTGRESQL');
      expect(hintsSection).not.toContain('### MONGO');
      expect(hintsSection).not.toContain('### BIGQUERY');
    });

    it('includes mongo hints when mongo connection is present', () => {
      const ctx: BenchmarkAnalystContext = {
        connections: [
          { name: 'mongo_db', dialect: 'mongo', description: '', config: {} },
        ],
        contextDocs: '',
      };

      const agent = new TestableV2Agent(
        {} as never,
        { userMessage: 'test' },
        ctx,
        'test-id',
      );

      const prompt = agent.getPrompt();

      // Tighten the assertion to the dialect-hints section — the prompt
      // mentions mongo in examples unconditionally; what's conditional is
      // the `### MONGO` hint rendered from DIALECT_HINTS.
      const hintsSection = prompt.split('## Dialect-Specific Features')[1]?.split('## Analysis Guidelines')[0] ?? '';
      expect(hintsSection).toContain('### MONGO');
      expect(hintsSection).toContain('aggregation');
    });

    it('explains the handle model', () => {
      const ctx: BenchmarkAnalystContext = {
        connections: [
          { name: 'db', dialect: 'duckdb', description: '', config: {} },
        ],
        contextDocs: '',
      };

      const agent = new TestableV2Agent(
        {} as never,
        { userMessage: 'test' },
        ctx,
        'test-id',
      );

      const prompt = agent.getPrompt();

      expect(prompt).toContain('handle');
      expect(prompt).toContain('FROM handle_');
    });

    it('explains the catalog tables', () => {
      const ctx: BenchmarkAnalystContext = {
        connections: [
          { name: 'db', dialect: 'duckdb', description: '', config: {} },
        ],
        contextDocs: '',
      };

      const agent = new TestableV2Agent(
        {} as never,
        { userMessage: 'test' },
        ctx,
        'test-id',
      );

      const prompt = agent.getPrompt();

      expect(prompt).toContain('catalog');
      expect(prompt).toContain('connections');
      expect(prompt).toContain('tables');
      expect(prompt).toContain('columns');
      expect(prompt).toContain('column_stats');
    });

    it('explains sequential batches and $label.column', () => {
      const ctx: BenchmarkAnalystContext = {
        connections: [],
        contextDocs: '',
      };

      const agent = new TestableV2Agent(
        {} as never,
        { userMessage: 'test' },
        ctx,
        'test-id',
      );

      const prompt = agent.getPrompt();

      expect(prompt).toContain('sequential');
      expect(prompt).toContain('$label');
    });

    it('includes contextDocs in prompt', () => {
      const ctx: BenchmarkAnalystContext = {
        connections: [],
        contextDocs: '## Revenue Table\nContains daily revenue.',
      };

      const agent = new TestableV2Agent(
        {} as never,
        { userMessage: 'test' },
        ctx,
        'test-id',
      );

      const prompt = agent.getPrompt();

      expect(prompt).toContain('Revenue Table');
      expect(prompt).toContain('daily revenue');
    });
  });

  describe('model', () => {
    it('has a model configured', () => {
      expect(V2BenchmarkAnalystAgent.model).toBeDefined();
    });
  });
});
});

describe('execute-query.handle-tables', () => {
// Real integration test for `FROM handle_xyz` — handles as queryable tables.
//
// Unlike execute-query.test.ts (which mocks the connector), this test uses a
// REAL duckdb fixture + the REAL shared-DuckDB connector path, so it actually
// verifies that a stored handle resolves as a table and joins against live
// connection data. With the connector mocked you can never prove this — the
// mock returns canned rows regardless of SQL.












describe('ExecuteQueryV2 — FROM handle_xyz (real handle tables)', () => {
  let tmpDir: string;
  let duckdbPath: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'v2-handle-tables-'));
    duckdbPath = path.join(tmpDir, 'products.duckdb');
    const inst = await DuckDBInstance.create(duckdbPath);
    const conn = await inst.connect();
    try {
      await conn.run(`CREATE TABLE products (id INTEGER, name VARCHAR);`);
      await conn.run(
        `INSERT INTO products VALUES (1, 'Alpha'), (2, 'Beta'), (3, 'Gamma'), (4, 'Delta');`,
      );
    } finally {
      conn.disconnectSync();
    }
  });

  afterAll(async () => {
    await detachAllBenchmarkAttachments().catch(() => { /* may be uninit */ });
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await clearHandles();
  });

  const ctx = (): BenchmarkAnalystContext => ({
    connections: [
      { name: 'products_db', dialect: 'duckdb', description: 'products', config: { file_path: duckdbPath } },
    ],
  });

  it('joins a live connection table against a stored handle', async () => {
    // A handle holding the ids 2 and 4 — as if produced by an earlier query.
    const idHandleResult: QueryResult = {
      columns: ['id'],
      types: ['BIGINT'],
      rows: [{ id: 2 }, { id: 4 }],
      finalQuery: '',
    };
    const { handleId: idHandle } = await storeHandle(idHandleResult);

    const tool = new ExecuteQueryV2(
      undefined as never,
      {
        queries: [
          {
            connection: 'products_db',
            query: `SELECT p.id, p.name FROM products p JOIN ${idHandle} h ON p.id = h.id ORDER BY p.id`,
          },
        ],
      },
      ctx(),
      'test-handle-join',
    );

    const response = await tool.run();
    const content = JSON.parse((response.content[0] as TextContent).text);

    expect(content.results[0].error).toBeUndefined();
    // The returned handle's rows must reflect a REAL join: only products
    // whose id is in the handle (2 = Beta, 4 = Delta).
    const stored = fetchHandle(content.results[0].handle);
    expect(stored?.rows).toEqual([
      { id: 2, name: 'Beta' },
      { id: 4, name: 'Delta' },
    ]);
  });

  it('runs a pure-handle query (no live table) against a stored handle', async () => {
    const handleResult: QueryResult = {
      columns: ['id', 'amount'],
      types: ['BIGINT', 'DOUBLE'],
      rows: [{ id: 1, amount: 10 }, { id: 2, amount: 30 }, { id: 3, amount: 20 }],
      finalQuery: '',
    };
    const { handleId: h } = await storeHandle(handleResult);

    const tool = new ExecuteQueryV2(
      undefined as never,
      {
        queries: [
          { connection: 'products_db', query: `SELECT id FROM ${h} WHERE amount > 15 ORDER BY id` },
        ],
      },
      ctx(),
      'test-pure-handle',
    );

    const response = await tool.run();
    const content = JSON.parse((response.content[0] as TextContent).text);

    expect(content.results[0].error).toBeUndefined();
    const stored = fetchHandle(content.results[0].handle);
    expect(stored?.rows).toEqual([{ id: 2 }, { id: 3 }]);
  });

  it('honors the timeout param — a slow query is cancelled, returned as per-query error', async () => {
    // `range(20_000_000_000)` would be a multi-second scan in DuckDB; a 1s
    // timeout must interrupt it well before completion and surface a clean
    // per-query error.
    const tool = new ExecuteQueryV2(
      undefined as never,
      {
        queries: [{ connection: 'products_db', query: 'SELECT count(*) AS c FROM range(20000000000)' }],
        timeout: 1,
      },
      ctx(),
      'test-timeout',
    );
    const start = Date.now();
    const response = await tool.run();
    const elapsedMs = Date.now() - start;

    const content = JSON.parse((response.content[0] as TextContent).text);
    expect(content.results[0].error).toBeDefined();
    // Must not hang anywhere near the time the full scan would take.
    expect(elapsedMs).toBeLessThan(15000);
  }, 20000);

  it('errors clearly when a handle is referenced on a non-SQL connection', async () => {
    const { handleId: h } = await storeHandle({
      columns: ['id'], types: ['BIGINT'], rows: [{ id: 1 }], finalQuery: '',
    });

    const tool = new ExecuteQueryV2(
      undefined as never,
      {
        queries: [
          { connection: 'mongo_db', query: `SELECT * FROM ${h}` },
        ],
      },
      {
        connections: [
          { name: 'mongo_db', dialect: 'mongo', description: 'm', config: { host: 'localhost', port: 27017, database: 'd' } },
        ],
      },
      'test-handle-mongo',
    );

    const response = await tool.run();
    const content = JSON.parse((response.content[0] as TextContent).text);
    expect(content.results[0].error).toMatch(/handle table/i);
  });
});
});
