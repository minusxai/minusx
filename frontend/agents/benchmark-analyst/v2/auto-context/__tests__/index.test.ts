/**
 * Tests for index.ts — `filterSchemaByQuestion` (LLM-driven table picker)
 * and `buildAutoContextFromCatalog` (the catalog-input integration wrapper).
 *
 * The top-level `buildAutoContext` (which also pulls the catalog via
 * `getCatalogStore`) is exercised through the agent integration in the
 * next task; this file covers the wiring with fixture inputs only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fauxAssistantMessage, registerFauxProvider } from '@mariozechner/pi-ai';
import type { CatalogTables } from '../../catalog';
import { clearRshipsCache } from '../rships';
import {
  parseFilterResponse,
  filterSchemaByQuestion,
  buildAutoContextFromCatalog,
} from '../index';
import type { FlatColumn } from '../schema';
import type { QueryResult, NodeConnector } from '@/lib/connections/base';

const fauxReg = registerFauxProvider({
  api: 'faux-autoctx-api',
  provider: 'faux-autoctx',
  models: [{ id: 'stub-autoctx' }],
});
const stubModel = fauxReg.getModel();

beforeEach(() => {
  clearRshipsCache();
});

function makeCatalog(opts: {
  columns: Array<{ connection: string; schema: string; table: string; column: string; type: string }>;
  tables?: Array<{ connection: string; schema: string; table: string; row_count: number }>;
  columnStats?: Array<Record<string, unknown>>;
}): CatalogTables {
  const empty = { columns: [], types: [], rows: [] };
  return {
    connections: empty,
    schemas: empty,
    tables: {
      columns: ['connection_name', 'schema_name', 'table_name', 'row_count'],
      types: ['VARCHAR', 'VARCHAR', 'VARCHAR', 'BIGINT'],
      rows: (opts.tables ?? []).map((t) => ({
        connection_name: t.connection,
        schema_name: t.schema,
        table_name: t.table,
        row_count: t.row_count,
      })),
    },
    columns: {
      columns: ['connection_name', 'schema_name', 'table_name', 'column_name', 'data_type'],
      types: ['VARCHAR', 'VARCHAR', 'VARCHAR', 'VARCHAR', 'VARCHAR'],
      rows: opts.columns.map((c) => ({
        connection_name: c.connection,
        schema_name: c.schema,
        table_name: c.table,
        column_name: c.column,
        data_type: c.type,
      })),
    },
    indexes: empty,
    column_stats: {
      columns: [
        'connection_name', 'schema_name', 'table_name', 'column_name',
        'category', 'n_distinct', 'null_count', 'min_value', 'max_value',
        'avg_value', 'min_date', 'max_date', 'top_values',
      ],
      types: [
        'VARCHAR', 'VARCHAR', 'VARCHAR', 'VARCHAR',
        'VARCHAR', 'BIGINT', 'BIGINT', 'DOUBLE', 'DOUBLE',
        'DOUBLE', 'VARCHAR', 'VARCHAR', 'VARCHAR',
      ],
      rows: opts.columnStats ?? [],
    },
    sample_rows: empty,
    sample_notes: empty,
  };
}

describe('parseFilterResponse', () => {
  it('parses a flat array of table identifiers', () => {
    expect(parseFilterResponse('["db.public.users","db.public.orders"]')).toEqual(
      new Set(['db.public.users', 'db.public.orders']),
    );
  });

  it('tolerates code-fence wrappers', () => {
    expect(parseFilterResponse('```json\n["a.b.c"]\n```')).toEqual(new Set(['a.b.c']));
  });

  it('returns empty set on malformed JSON', () => {
    expect(parseFilterResponse('not json')).toEqual(new Set());
  });

  it('drops non-string entries', () => {
    expect(parseFilterResponse('["a.b.c", 42, null, "x.y.z"]')).toEqual(
      new Set(['a.b.c', 'x.y.z']),
    );
  });
});

describe('filterSchemaByQuestion', () => {
  const schema: FlatColumn[] = [
    { connection: 'db', schema: 'public', table: 'users', column: 'id', type: 'INTEGER' },
    { connection: 'db', schema: 'public', table: 'orders', column: 'user_id', type: 'INTEGER' },
    { connection: 'db', schema: 'public', table: 'unrelated', column: 'x', type: 'INTEGER' },
  ];

  it('returns the LLM-picked table identifiers', async () => {
    const callLLM = vi.fn(async () =>
      fauxAssistantMessage('["db.public.users","db.public.orders"]'),
    );
    const out = await filterSchemaByQuestion(
      schema, 'tell me about user activity', { originalMessage: 'tell me about user activity' }, stubModel, callLLM,
    );
    expect(out).toEqual(new Set(['db.public.users', 'db.public.orders']));
  });

  it('includes the user question in the LLM prompt', async () => {
    let captured = '';
    const callLLM = vi.fn(async (_m, ctx) => {
      const first = ctx.messages[0]?.content;
      captured = typeof first === 'string' ? first : '';
      return fauxAssistantMessage('[]');
    });
    await filterSchemaByQuestion(schema, 'show me order patterns', { originalMessage: 'show me order patterns' }, stubModel, callLLM);
    expect(captured).toContain('show me order patterns');
  });
});

describe('buildAutoContextFromCatalog', () => {
  const fakeConn = (rows: Record<string, unknown>[]): NodeConnector =>
    ({
      query: vi.fn(async () => ({
        columns: Object.keys(rows[0] ?? {}),
        types: Object.keys(rows[0] ?? {}).map(() => 'TEXT'),
        rows,
        finalQuery: '',
      }) as QueryResult),
    }) as unknown as NodeConnector;

  it('renders a markdown block including known tables and column notes', async () => {
    const catalog = makeCatalog({
      columns: [
        { connection: 'db', schema: 'main', table: 'users', column: 'id', type: 'INTEGER' },
        { connection: 'db', schema: 'main', table: 'users', column: 'email', type: 'VARCHAR' },
      ],
      tables: [{ connection: 'db', schema: 'main', table: 'users', row_count: 42 }],
    });

    const callLLM = vi.fn(async () =>
      fauxAssistantMessage(
        JSON.stringify({
          table_note: 'users table summary',
          columns: [
            { name: 'id', note: 'identifier' },
            { name: 'email', note: 'login email' },
          ],
        }),
      ),
    );

    const md = await buildAutoContextFromCatalog(catalog, {
      connectorsByName: new Map([['db', fakeConn([{ id: 1, email: 'a@x.com' }])]]),
      dialectsByName: new Map([['db', 'duckdb']]),
      datasetKey: 'fixture-1',
      llmContext: { originalMessage: 'should-be-stripped-from-cache' },
      model: stubModel,
      callLLM,
      maxChars: 50_000,
    });

    expect(md).toContain('db.main.users');
    expect(md).toContain('users table summary');
    expect(md).toContain('identifier');
    expect(md).toContain('login email');
    // 42 rows annotation
    expect(md).toContain('42');
  });

  it('produces output below maxChars', async () => {
    const catalog = makeCatalog({
      columns: Array.from({ length: 50 }, (_, i) => ({
        connection: 'db', schema: 'main', table: `t${i}`, column: 'c', type: 'INTEGER',
      })),
    });
    const callLLM = vi.fn(async () => fauxAssistantMessage('{"table_note":"x","columns":[]}'));
    const md = await buildAutoContextFromCatalog(catalog, {
      connectorsByName: new Map([['db', fakeConn([{ c: 1 }])]]),
      dialectsByName: new Map([['db', 'duckdb']]),
      datasetKey: 'fixture-2',
      llmContext: {},
      model: stubModel,
      callLLM,
      maxChars: 1_500,
    });
    expect(md.length).toBeLessThanOrEqual(1_500);
  });
});
