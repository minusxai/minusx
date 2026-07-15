/**
 * V37 — the static-sources / config-databases split:
 *
 *  1. DB connection docs (/database/<name>, warehouse types) COPY their spec
 *     into the mode config's `databases.connections` (names byte-identical);
 *     the doc remains as schema-cache holder. duckdb/internal_db stay put
 *     (system plumbing, not user infrastructure).
 *  2. Static connections (csv / google-sheets) become DATASET docs at the mode
 *     ROOT (same s3 keys — zero data movement; root = the same everywhere
 *     reach they had as global connections). Legacy source fields map:
 *     csv→upload, google_sheets→link (+source_url/source_group).
 *  3. Saved content that referenced a static connection by name — questions,
 *     notebook cells, context whitelists — is rewritten to the virtual `files`
 *     connection, so nothing breaks.
 *  4. schema.table collisions across old static connections are renamed with a
 *     numeric suffix (first wins) — loudly, via the migration's report field.
 */
import { describe, it, expect } from 'vitest';
import { applyMigrations } from '@/lib/database/migrations';
import type { InitData } from '@/lib/database/import-export';
import type { DbFile } from '@/lib/types';

const doc = (id: number, path: string, type: string, content: object): DbFile => ({
  id, name: path.split('/').pop()!, path, type, content,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  version: 1, last_edit_id: 'e1', draft: false,
} as unknown as DbFile);

const csvFile = (schema: string, table: string, over: object = {}) => ({
  filename: `${table}.csv`, table_name: table, schema_name: schema,
  s3_key: `org1/${schema}/${table}.csv`, file_format: 'csv', row_count: 5,
  columns: [{ name: 'id', type: 'BIGINT' }], source_type: 'csv', ...over,
});

function fixture(): InitData {
  return {
    version: 36,
    users: [],
    documents: [
      doc(1, '/org', 'folder', {}),
      doc(2, '/org/configs', 'folder', {}),
      doc(3, '/org/configs/config', 'config', { branding: { displayName: 'X' } }),
      doc(4, '/org/database', 'folder', {}),
      // A warehouse connection → config
      doc(5, '/org/database/warehouse', 'connection', {
        type: 'postgresql', config: { host: 'db.internal', password: '@SECRETS/x' },
        schema: { schemas: [], updated_at: 'now' },
      }),
      // System connections stay put
      doc(6, '/org/database/default_db', 'connection', { type: 'duckdb', config: { file_path: 'x.duckdb' } }),
      // Static connections → datasets at root
      doc(7, '/org/database/static', 'connection', {
        type: 'csv', config: { files: [
          csvFile('mxfood', 'orders'),
          csvFile('sheets', 'budget', { source_type: 'google_sheets', spreadsheet_url: 'https://sheet', spreadsheet_id: 'sid' }),
        ]},
      }),
      doc(8, '/org/database/uploads2', 'connection', {
        type: 'csv', config: { files: [csvFile('mxfood', 'orders', { s3_key: 'org1/other/orders.csv' })] }, // COLLIDES with static's mxfood.orders
      }),
      // Content referencing connections by name
      doc(9, '/org/q-static', 'question', { query: 'SELECT 1', connection_name: 'static', vizSettings: { type: 'table' }, parameters: [] }),
      doc(10, '/org/q-wh', 'question', { query: 'SELECT 2', connection_name: 'warehouse', vizSettings: { type: 'table' }, parameters: [] }),
      doc(11, '/org/nb', 'notebook', { cells: [{ type: 'sql', id: 'c1', query: 'SELECT 3', connection_name: 'static', vizSettings: { type: 'table' }, parameters: [], references: [] }] }),
      doc(12, '/org/context', 'context', {
        versions: [{ version: 1, whitelist: [{ name: 'static', type: 'connection' }, { name: 'warehouse', type: 'connection' }], docs: [], createdAt: 'now', createdBy: 1 }],
        published: { all: 1 },
      }),
    ],
  };
}

function migrate(): DbFile[] {
  const out = applyMigrations(fixture(), 36);
  return (out.documents ?? []) as DbFile[];
}

describe('v37: DB connections → config', () => {
  it('copies warehouse specs into config.databases with byte-identical names; doc remains', () => {
    const docs = migrate();
    const config = docs.find((d) => d.path === '/org/configs/config')!.content as {
      databases?: { connections: Array<{ name: string; type: string; config: Record<string, unknown> }> };
    };
    expect(config.databases?.connections.map((c) => c.name)).toEqual(['warehouse']);
    expect(config.databases?.connections[0].config.host).toBe('db.internal');
    // schema-cache holder survives
    expect(docs.find((d) => d.path === '/org/database/warehouse')).toBeTruthy();
    // system connections not copied
    expect(config.databases?.connections.find((c) => c.name === 'default_db')).toBeUndefined();
  });
});

describe('v37: static connections → root datasets', () => {
  it('creates dataset docs at the mode root with mapped sources; old docs removed', () => {
    const docs = migrate();
    expect(docs.find((d) => d.path === '/org/database/static')).toBeUndefined();
    const ds = docs.find((d) => d.path === '/org/static' && d.type === 'dataset')!;
    expect(ds).toBeTruthy();
    const files = (ds.content as { files: Array<Record<string, unknown>> }).files;
    const orders = files.find((f) => f.table_name === 'orders')!;
    expect(orders.source).toBe('upload');
    expect(orders.s3_key).toBe('org1/mxfood/orders.csv'); // zero data movement
    const budget = files.find((f) => f.table_name === 'budget')!;
    expect(budget.source).toBe('link');
    expect(budget.source_url).toBe('https://sheet');
    expect(budget.source_group).toBe('sid');
  });

  it('renames colliding schema.table (first wins, numeric suffix)', () => {
    const docs = migrate();
    const ds2 = docs.find((d) => d.path === '/org/uploads2' && d.type === 'dataset')!;
    const files = (ds2.content as { files: Array<Record<string, unknown>> }).files;
    expect(files[0].schema_name).toBe('mxfood');
    expect(files[0].table_name).toBe('orders_2'); // static's mxfood.orders won
  });
});

describe('v37: connection_name rewrites', () => {
  it('questions/notebook cells on a static connection point at files; warehouse untouched', () => {
    const docs = migrate();
    expect((docs.find((d) => d.path === '/org/q-static')!.content as { connection_name: string }).connection_name).toBe('files');
    expect((docs.find((d) => d.path === '/org/q-wh')!.content as { connection_name: string }).connection_name).toBe('warehouse');
    const nb = docs.find((d) => d.path === '/org/nb')!.content as { cells: Array<{ connection_name: string }> };
    expect(nb.cells[0].connection_name).toBe('files');
  });

  it('context whitelists rename static entries to files', () => {
    const docs = migrate();
    const ctx = docs.find((d) => d.path === '/org/context')!.content as {
      versions: Array<{ whitelist: Array<{ name: string }> }>;
    };
    expect(ctx.versions[0].whitelist.map((w) => w.name).sort()).toEqual(['files', 'warehouse']);
  });
});
