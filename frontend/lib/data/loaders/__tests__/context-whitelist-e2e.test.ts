/**
 * Comprehensive E2E — Context Resolution & Whitelist Schema
 *
 * This single file encodes every rule introduced by the "default context per folder"
 * feature and the accompanying whitelist schema redesign.  The tests are written
 * RED-first: they will fail until the implementation is complete.
 *
 * Coverage:
 *   1.  applyWhitelistToConnections — new top-level filter (replaces filterSchemaByWhitelist)
 *   2.  filterSchemaByWhitelistNode — per-connection filter
 *   3.  Context loader with ContextVersion.whitelist (new schema)
 *   4.  whitelist:'*' root context  → all connection schemas exposed
 *   5.  whitelist:'*' child context → passes ALL parent schemas through unchanged
 *   6.  Specific WhitelistNode tree filters parent schemas correctly
 *   7.  childPaths on WhitelistNode restricts inheritance to sub-paths
 *   8.  Default context created atomically when folder is created
 *   9.  Default context has whitelist:'*'
 *  10.  Deep chain: every folder in a path has a context and whitelist:'*' propagates
 *  11.  Context cannot be deleted standalone (rules.json blocklist)
 *  12.  Folder CAN be deleted even though it contains a context (cascade fix)
 *  13.  V33 migration: converts old databases[] format → new WhitelistNode tree
 *  14.  V33 migration: creates default context (whitelist:'*') for every folder without one
 *
 * Run: npx jest context-whitelist-e2e --no-coverage --verbose
 */

// ─────────────────────────────────────────────────────────────────────────────
// Jest infrastructure mocks (must be at top due to hoisting)
// ─────────────────────────────────────────────────────────────────────────────

jest.mock('@/lib/connections', () => ({
  getNodeConnector: () => null,
}));

jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_context_whitelist_e2e.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────────────────

import { DocumentDB } from '@/lib/database/documents-db';
import { FilesAPI } from '@/lib/data/files.server';
import { initTestDatabase, cleanupTestDatabase, getTestDbPath } from '@/store/__tests__/test-utils';
import type {
  ContextContent,
  ContextVersion,
  DatabaseSchema,
  DatabaseWithSchema,
  ConnectionContent,
  // ↓ NEW types — these imports are RED until Phase 1 is implemented
  Whitelist,
  WhitelistNode,
} from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import * as pythonBackend from '@/lib/backend/python-backend.server';

// ↓ NEW functions — RED until Phase 2 is implemented
import {
  applyWhitelistToConnections,
  filterSchemaByWhitelistNode,
} from '@/lib/sql/schema-filter';

// ↓ NEW helper — RED until Phase 5 is implemented
import { makeDefaultContextContent } from '@/lib/context/context-utils';

// ↓ V33 migration entry — RED until Phase 7 is implemented
import { MIGRATIONS } from '@/lib/database/migrations';

const TEST_DB_PATH = getTestDbPath('context_whitelist_e2e');

// ─────────────────────────────────────────────────────────────────────────────
// Shared test data
// ─────────────────────────────────────────────────────────────────────────────

/** Two fake connections with disjoint schemas */
const CONN_A: DatabaseWithSchema = {
  databaseName: 'conn_a',
  schemas: [
    {
      schema: 'public',
      tables: [
        { table: 'users',    columns: [{ name: 'id',    type: 'INTEGER' }] },
        { table: 'orders',   columns: [{ name: 'id',    type: 'INTEGER' }] },
        { table: 'products', columns: [{ name: 'id',    type: 'INTEGER' }] },
      ],
    },
    {
      schema: 'analytics',
      tables: [
        { table: 'events', columns: [{ name: 'id', type: 'INTEGER' }] },
      ],
    },
  ],
};

const CONN_B: DatabaseWithSchema = {
  databaseName: 'conn_b',
  schemas: [
    {
      schema: 'main',
      tables: [
        { table: 'sales', columns: [{ name: 'id', type: 'INTEGER' }] },
      ],
    },
  ],
};

const ALL_CONNECTIONS = [CONN_A, CONN_B];

// Helper — extract table names across all schemas of a single connection result
function tableNames(result: DatabaseWithSchema): string[] {
  return result.schemas.flatMap(s => s.tables.map(t => t.table));
}

// Helper — extract schema names of a single connection result
function schemaNames(result: DatabaseWithSchema): string[] {
  return result.schemas.map(s => s.schema);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test users
// ─────────────────────────────────────────────────────────────────────────────

const admin: EffectiveUser = {
  userId: 1, name: 'Admin', email: 'admin@test.com',
  role: 'admin', companyId: 1, companyName: 'test', mode: 'org', home_folder: '',
};

const viewer: EffectiveUser = {
  userId: 2, name: 'Viewer', email: 'viewer@test.com',
  role: 'viewer', companyId: 1, companyName: 'test', mode: 'org', home_folder: '',
};

// ─────────────────────────────────────────────────────────────────────────────
// DB lifecycle
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const { resetAdapter } = await import('@/lib/database/adapter/factory');
  await resetAdapter();
  await initTestDatabase(TEST_DB_PATH);
});

afterAll(async () => {
  await cleanupTestDatabase(TEST_DB_PATH);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1 & 2  New whitelist filter functions
// ─────────────────────────────────────────────────────────────────────────────

describe('applyWhitelistToConnections — new top-level filter', () => {
  it("whitelist:'*' returns all connections unchanged", () => {
    const result = applyWhitelistToConnections(ALL_CONNECTIONS, '*');
    expect(result).toHaveLength(2);
    const connA = result.find(c => c.databaseName === 'conn_a')!;
    const connB = result.find(c => c.databaseName === 'conn_b')!;
    expect(tableNames(connA).sort()).toEqual(['events', 'orders', 'products', 'users']);
    expect(tableNames(connB)).toEqual(['sales']);
  });

  it('whitelist:[] returns no connections', () => {
    const result = applyWhitelistToConnections(ALL_CONNECTIONS, []);
    expect(result).toHaveLength(0);
  });

  it('whitelist with one connection node (children:undefined) returns all schemas of that connection', () => {
    const whitelist: WhitelistNode[] = [{ name: 'conn_a', type: 'connection' }];
    const result = applyWhitelistToConnections(ALL_CONNECTIONS, whitelist);
    expect(result).toHaveLength(1);
    expect(result[0].databaseName).toBe('conn_a');
    expect(schemaNames(result[0]).sort()).toEqual(['analytics', 'public']);
    expect(tableNames(result[0]).sort()).toEqual(['events', 'orders', 'products', 'users']);
  });

  it('connection node with specific schema children', () => {
    const whitelist: WhitelistNode[] = [{
      name: 'conn_a', type: 'connection',
      children: [{ name: 'public', type: 'schema' }],  // only public, not analytics
    }];
    const result = applyWhitelistToConnections(ALL_CONNECTIONS, whitelist);
    expect(result).toHaveLength(1);
    expect(schemaNames(result[0])).toEqual(['public']);
    expect(tableNames(result[0]).sort()).toEqual(['orders', 'products', 'users']); // not events
  });

  it('connection node with specific table children', () => {
    const whitelist: WhitelistNode[] = [{
      name: 'conn_a', type: 'connection',
      children: [{
        name: 'public', type: 'schema',
        children: [
          { name: 'users',  type: 'table' },
          { name: 'orders', type: 'table' },
        ],
      }],
    }];
    const result = applyWhitelistToConnections(ALL_CONNECTIONS, whitelist);
    expect(result).toHaveLength(1);
    expect(tableNames(result[0]).sort()).toEqual(['orders', 'users']); // not products
  });

  it('connection node with children:[] exposes nothing from that connection', () => {
    const whitelist: WhitelistNode[] = [{ name: 'conn_a', type: 'connection', children: [] }];
    const result = applyWhitelistToConnections(ALL_CONNECTIONS, whitelist);
    expect(result).toHaveLength(0); // conn_a is effectively empty → filtered out
  });

  it('schema node with children:[] exposes nothing from that schema', () => {
    const whitelist: WhitelistNode[] = [{
      name: 'conn_a', type: 'connection',
      children: [{ name: 'public', type: 'schema', children: [] }],
    }];
    const result = applyWhitelistToConnections(ALL_CONNECTIONS, whitelist);
    // conn_a is present but has no tables → filtered out or empty
    const connA = result.find(c => c.databaseName === 'conn_a');
    if (connA) {
      expect(tableNames(connA)).toHaveLength(0);
    }
    // analytics schema not included either
    expect(result.find(c => c.databaseName === 'conn_a')?.schemas.find(s => s.schema === 'analytics')).toBeUndefined();
  });

  it('multiple connections in whitelist', () => {
    const whitelist: WhitelistNode[] = [
      { name: 'conn_a', type: 'connection', children: [{ name: 'analytics', type: 'schema' }] },
      { name: 'conn_b', type: 'connection' },
    ];
    const result = applyWhitelistToConnections(ALL_CONNECTIONS, whitelist);
    expect(result).toHaveLength(2);
    const connA = result.find(c => c.databaseName === 'conn_a')!;
    const connB = result.find(c => c.databaseName === 'conn_b')!;
    expect(tableNames(connA)).toEqual(['events']); // only analytics
    expect(tableNames(connB)).toEqual(['sales']);
  });

  it('childPaths restricts which paths receive a connection node', () => {
    const whitelist: WhitelistNode[] = [
      { name: 'conn_a', type: 'connection', childPaths: ['/org/team_a'] },
    ];
    // Path inside /org/team_a → receives conn_a
    const forTeamA = applyWhitelistToConnections(ALL_CONNECTIONS, whitelist, '/org/team_a');
    expect(forTeamA).toHaveLength(1);
    expect(forTeamA[0].databaseName).toBe('conn_a');

    // Path NOT inside /org/team_a → does not receive conn_a
    const forTeamB = applyWhitelistToConnections(ALL_CONNECTIONS, whitelist, '/org/team_b');
    expect(forTeamB).toHaveLength(0);
  });

  it('childPaths:[] means the node is never inherited by any child', () => {
    const whitelist: WhitelistNode[] = [
      { name: 'conn_a', type: 'connection', childPaths: [] },
    ];
    const result = applyWhitelistToConnections(ALL_CONNECTIONS, whitelist, '/org/anything');
    expect(result).toHaveLength(0);
  });

  it('nested path matches childPaths via startsWith', () => {
    const whitelist: WhitelistNode[] = [
      { name: 'conn_a', type: 'connection', childPaths: ['/org/sales'] },
    ];
    const result = applyWhitelistToConnections(ALL_CONNECTIONS, whitelist, '/org/sales/team1');
    expect(result).toHaveLength(1); // /org/sales/team1 starts with /org/sales
  });
});

describe('filterSchemaByWhitelistNode — single-connection filter', () => {
  const fullSchema: DatabaseSchema = {
    updated_at: '2024-01-01',
    schemas: [
      {
        schema: 'public',
        tables: [
          { table: 'users',    columns: [] },
          { table: 'orders',   columns: [] },
          { table: 'products', columns: [] },
        ],
      },
      {
        schema: 'analytics',
        tables: [{ table: 'events', columns: [] }],
      },
    ],
  };

  it('connNode.children:undefined → all schemas and tables', () => {
    const node: WhitelistNode = { name: 'conn_a', type: 'connection' };
    const result = filterSchemaByWhitelistNode(fullSchema, node);
    expect(result.schemas).toHaveLength(2);
    expect(result.schemas.map(s => s.schema).sort()).toEqual(['analytics', 'public']);
  });

  it('specific schema children → only those schemas', () => {
    const node: WhitelistNode = {
      name: 'conn_a', type: 'connection',
      children: [{ name: 'public', type: 'schema' }],
    };
    const result = filterSchemaByWhitelistNode(fullSchema, node);
    expect(result.schemas).toHaveLength(1);
    expect(result.schemas[0].schema).toBe('public');
    expect(result.schemas[0].tables.map(t => t.table).sort()).toEqual(['orders', 'products', 'users']);
  });

  it('schema node children:undefined → all tables in that schema', () => {
    const node: WhitelistNode = {
      name: 'conn_a', type: 'connection',
      children: [{ name: 'public', type: 'schema' }], // no children on schema node
    };
    const result = filterSchemaByWhitelistNode(fullSchema, node);
    const pub = result.schemas.find(s => s.schema === 'public')!;
    expect(pub.tables).toHaveLength(3);
  });

  it('specific table children → only those tables', () => {
    const node: WhitelistNode = {
      name: 'conn_a', type: 'connection',
      children: [{
        name: 'public', type: 'schema',
        children: [{ name: 'users', type: 'table' }],
      }],
    };
    const result = filterSchemaByWhitelistNode(fullSchema, node);
    expect(result.schemas).toHaveLength(1);
    expect(result.schemas[0].tables).toHaveLength(1);
    expect(result.schemas[0].tables[0].table).toBe('users');
  });

  it('children:[] → empty schemas', () => {
    const node: WhitelistNode = {
      name: 'conn_a', type: 'connection',
      children: [],
    };
    const result = filterSchemaByWhitelistNode(fullSchema, node);
    expect(result.schemas).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3–6  Context loader with new whitelist schema
// ─────────────────────────────────────────────────────────────────────────────

describe('Context loader — ContextVersion.whitelist (new schema)', () => {
  const mockGetSchemaFromPython = jest.spyOn(pythonBackend, 'getSchemaFromPython');

  beforeEach(async () => {
    jest.clearAllMocks();
    const { getAdapter } = await import('@/lib/database/adapter/factory');
    const db = await getAdapter();
    await db.query('DELETE FROM files WHERE company_id = $1', [1]);

    // Two connections — one DuckDB, one BigQuery
    mockGetSchemaFromPython.mockImplementation((name: string) => {
      if (name === 'duckdb_main') {
        return Promise.resolve({
          schemas: [{
            schema: 'public',
            tables: [
              { table: 'users',    columns: [{ name: 'id', type: 'INTEGER' }] },
              { table: 'orders',   columns: [{ name: 'id', type: 'INTEGER' }] },
              { table: 'products', columns: [{ name: 'id', type: 'INTEGER' }] },
            ],
          }],
          updated_at: new Date().toISOString(),
        } as DatabaseSchema);
      }
      if (name === 'bigquery_analytics') {
        return Promise.resolve({
          schemas: [{
            schema: 'analytics',
            tables: [{ table: 'events', columns: [{ name: 'id', type: 'STRING' }] }],
          }],
          updated_at: new Date().toISOString(),
        } as DatabaseSchema);
      }
      return Promise.resolve({ schemas: [], updated_at: new Date().toISOString() } as DatabaseSchema);
    });

    // Create connection files
    await DocumentDB.create('duckdb_main', '/org/database/duckdb_main', 'connection',
      { type: 'duckdb', config: { file_path: '../data/test.duckdb' }, description: '' } as ConnectionContent,
      [], 1);
    await DocumentDB.create('bigquery_analytics', '/org/database/bigquery_analytics', 'connection',
      { type: 'bigquery', config: { project_id: 'test' }, description: '' } as ConnectionContent,
      [], 1);
  });

  // ── Test 4: root context with whitelist:'*' ──────────────────────────────

  it("root context with whitelist:'*' exposes all connections and all schemas", async () => {
    const v: ContextVersion = {
      version: 1,
      whitelist: '*',   // ← NEW field; would have been databases:[] previously
      docs: [],
      createdAt: new Date().toISOString(),
      createdBy: 1,
    };
    const id = await DocumentDB.create('context', '/org/context', 'context',
      { versions: [v], published: { all: 1 } } as ContextContent,
      [], 1);

    const { data: [loaded] } = await FilesAPI.loadFiles([id], viewer);
    const content = loaded.content as ContextContent;

    // Both connections should appear in fullSchema
    const duckdb = content.fullSchema!.find(db => db.databaseName === 'duckdb_main');
    const bq     = content.fullSchema!.find(db => db.databaseName === 'bigquery_analytics');
    expect(duckdb).toBeDefined();
    expect(bq).toBeDefined();
    expect(duckdb!.schemas[0].tables.map(t => t.table).sort())
      .toEqual(['orders', 'products', 'users']);
    expect(bq!.schemas[0].tables[0].table).toBe('events');
  });

  // ── Test: root context with specific whitelist filters connections ────────

  it('root context with specific connection whitelist filters correctly', async () => {
    const v: ContextVersion = {
      version: 1,
      whitelist: [
        {
          name: 'duckdb_main', type: 'connection',
          children: [
            { name: 'public', type: 'schema',
              children: [{ name: 'users', type: 'table' }, { name: 'orders', type: 'table' }] },
          ],
        },
        // bigquery_analytics NOT whitelisted
      ] as WhitelistNode[],
      docs: [],
      createdAt: new Date().toISOString(),
      createdBy: 1,
    };
    const id = await DocumentDB.create('context', '/org/context', 'context',
      { versions: [v], published: { all: 1 } } as ContextContent,
      [], 1);

    const { data: [loaded] } = await FilesAPI.loadFiles([id], viewer);
    const content = loaded.content as ContextContent;

    // Only duckdb_main exposed; only users+orders (not products)
    expect(content.fullSchema!).toHaveLength(1);
    const duckdb = content.fullSchema![0];
    expect(duckdb.databaseName).toBe('duckdb_main');
    const tables = duckdb.schemas[0].tables.map(t => t.table).sort();
    expect(tables).toEqual(['orders', 'users']);
    expect(tables).not.toContain('products');
  });

  // ── Test 5: child context with whitelist:'*' passes ALL parent schemas ────

  it("child context with whitelist:'*' inherits ALL parent schemas unchanged", async () => {
    // Parent at /org/context whitelists only duckdb_main/public/users
    const parentVersion: ContextVersion = {
      version: 1,
      whitelist: [{
        name: 'duckdb_main', type: 'connection',
        children: [{ name: 'public', type: 'schema',
          children: [{ name: 'users', type: 'table' }] }],
      }] as WhitelistNode[],
      docs: [{ content: 'parent doc' }],
      createdAt: new Date().toISOString(),
      createdBy: 1,
    };
    await DocumentDB.create('context', '/org/context', 'context',
      { versions: [parentVersion], published: { all: 1 } } as ContextContent,
      [], 1);

    // Child at /org/sales/context with whitelist:'*' — should see everything parent exposes
    const childVersion: ContextVersion = {
      version: 1,
      whitelist: '*',  // expose all that we receive
      docs: [],
      createdAt: new Date().toISOString(),
      createdBy: 1,
    };
    const childId = await DocumentDB.create('context', '/org/sales/context', 'context',
      { versions: [childVersion], published: { all: 1 } } as ContextContent,
      [], 1);

    const { data: [childLoaded] } = await FilesAPI.loadFiles([childId], viewer);
    const childContent = childLoaded.content as ContextContent;

    // fullSchema must be the parent's fullSchema passed through completely
    expect(childContent.fullSchema!).toHaveLength(1);
    const duckdb = childContent.fullSchema![0];
    expect(duckdb.databaseName).toBe('duckdb_main');
    expect(duckdb.schemas[0].tables).toHaveLength(1);
    expect(duckdb.schemas[0].tables[0].table).toBe('users');

    // fullDocs must also flow through
    expect(childContent.fullDocs!.map(d => d.content)).toContain('parent doc');
  });

  // ── Test 6: child context with specific whitelist filters parent schemas ──

  it('child context with specific whitelist filters the parent-provided fullSchema', async () => {
    // Parent exposes all of duckdb_main (users, orders, products)
    const parentVersion: ContextVersion = {
      version: 1,
      whitelist: [{ name: 'duckdb_main', type: 'connection' }] as WhitelistNode[],
      docs: [],
      createdAt: new Date().toISOString(),
      createdBy: 1,
    };
    await DocumentDB.create('context', '/org/context', 'context',
      { versions: [parentVersion], published: { all: 1 } } as ContextContent,
      [], 1);

    // Child only whitelists the orders table
    const childVersion: ContextVersion = {
      version: 1,
      whitelist: [{
        name: 'duckdb_main', type: 'connection',
        children: [{ name: 'public', type: 'schema',
          children: [{ name: 'orders', type: 'table' }] }],
      }] as WhitelistNode[],
      docs: [],
      createdAt: new Date().toISOString(),
      createdBy: 1,
    };
    const childId = await DocumentDB.create('context', '/org/sales/context', 'context',
      { versions: [childVersion], published: { all: 1 } } as ContextContent,
      [], 1);

    const { data: [childLoaded] } = await FilesAPI.loadFiles([childId], viewer);
    const childContent = childLoaded.content as ContextContent;

    const duckdb = childContent.fullSchema!.find(db => db.databaseName === 'duckdb_main')!;
    expect(duckdb).toBeDefined();
    const tables = duckdb.schemas[0].tables.map(t => t.table);
    expect(tables).toEqual(['orders']);
    expect(tables).not.toContain('users');
    expect(tables).not.toContain('products');
  });

  // ── Test 7: childPaths on WhitelistNode restricts which paths inherit ─────

  it('childPaths on WhitelistNode restricts schema to specified sub-paths only', async () => {
    // Parent at /org/context: duckdb_main/public/users for /org/team_a only,
    //                          duckdb_main/public/orders for /org/team_b only
    const parentVersion: ContextVersion = {
      version: 1,
      whitelist: [{
        name: 'duckdb_main', type: 'connection',
        children: [
          { name: 'public', type: 'schema', children: [
            { name: 'users',  type: 'table', childPaths: ['/org/team_a'] },
            { name: 'orders', type: 'table', childPaths: ['/org/team_b'] },
          ]},
        ],
      }] as WhitelistNode[],
      docs: [],
      createdAt: new Date().toISOString(),
      createdBy: 1,
    };
    await DocumentDB.create('context', '/org/context', 'context',
      { versions: [parentVersion], published: { all: 1 } } as ContextContent,
      [], 1);

    // team_a child: whitelist:'*' — should get users (not orders)
    const teamAVersion: ContextVersion = {
      version: 1, whitelist: '*', docs: [],
      createdAt: new Date().toISOString(), createdBy: 1,
    };
    const teamAId = await DocumentDB.create('context', '/org/team_a/context', 'context',
      { versions: [teamAVersion], published: { all: 1 } } as ContextContent, [], 1);

    // team_b child: whitelist:'*' — should get orders (not users)
    const teamBVersion: ContextVersion = {
      version: 1, whitelist: '*', docs: [],
      createdAt: new Date().toISOString(), createdBy: 1,
    };
    const teamBId = await DocumentDB.create('context', '/org/team_b/context', 'context',
      { versions: [teamBVersion], published: { all: 1 } } as ContextContent, [], 1);

    const { data: [teamA] } = await FilesAPI.loadFiles([teamAId], viewer);
    const { data: [teamB] } = await FilesAPI.loadFiles([teamBId], viewer);

    const teamATables = (teamA.content as ContextContent).fullSchema![0].schemas[0].tables.map(t => t.table);
    const teamBTables = (teamB.content as ContextContent).fullSchema![0].schemas[0].tables.map(t => t.table);

    expect(teamATables).toContain('users');
    expect(teamATables).not.toContain('orders');

    expect(teamBTables).toContain('orders');
    expect(teamBTables).not.toContain('users');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8–10  Default context per folder
// ─────────────────────────────────────────────────────────────────────────────

describe('Default context per folder', () => {
  beforeEach(async () => {
    const { getAdapter } = await import('@/lib/database/adapter/factory');
    const db = await getAdapter();
    await db.query('DELETE FROM files WHERE company_id = $1', [1]);
    // Re-create the /org root folder so parent checks pass
    await DocumentDB.create('org', '/org', 'folder', { description: '' }, [], 1);
  });

  // ── Test 8: folder creation atomically creates a context ─────────────────

  it('creating a folder creates a context file at {folder}/context', async () => {
    await FilesAPI.createFile(
      { name: 'my-team', path: '/org/my-team', type: 'folder', content: { description: '' }, references: [] },
      admin,
    );

    // Context must now exist
    const contextFile = await DocumentDB.getByPath('/org/my-team/context', 1);
    expect(contextFile).toBeDefined();
    expect(contextFile!.type).toBe('context');
  });

  // ── Test 9: default context has whitelist:'*' ────────────────────────────

  it("default context has whitelist:'*' in its published version", async () => {
    await FilesAPI.createFile(
      { name: 'sales', path: '/org/sales', type: 'folder', content: { description: '' }, references: [] },
      admin,
    );

    const contextFile = await DocumentDB.getByPath('/org/sales/context', 1);
    expect(contextFile).toBeDefined();

    const content = contextFile!.content as ContextContent;
    expect(content.versions).toHaveLength(1);
    expect(content.versions![0].whitelist).toBe('*');
    expect(content.published.all).toBe(1);
  });

  // ── makeDefaultContextContent helper produces expected shape ─────────────

  it('makeDefaultContextContent() produces a valid context with whitelist:*', () => {
    const content = makeDefaultContextContent(1);
    expect(content.versions).toHaveLength(1);
    expect(content.versions![0].whitelist).toBe('*');
    expect(content.published.all).toBe(1);
  });

  // ── Test 10: deep chain — whitelist:'*' propagates through all levels ────

  it("deep chain: /org → /org/a → /org/a/b all with whitelist:'*' propagates all schemas", async () => {
    // Simulate the DB having three levels of default contexts
    // (createPath would create all three in production)

    const mockGetSchemaFromPython = jest.spyOn(pythonBackend, 'getSchemaFromPython');
    mockGetSchemaFromPython.mockResolvedValue({
      schemas: [{
        schema: 'public',
        tables: [{ table: 'users', columns: [] }, { table: 'orders', columns: [] }],
      }],
      updated_at: new Date().toISOString(),
    } as DatabaseSchema);

    await DocumentDB.create('duckdb_main', '/org/database/duckdb_main', 'connection',
      { type: 'duckdb', config: { file_path: '../data/test.duckdb' }, description: '' } as ConnectionContent,
      [], 1);

    // Three levels, all whitelist:'*'
    const makeCtx = (): ContextContent => ({
      versions: [{ version: 1, whitelist: '*', docs: [], createdAt: new Date().toISOString(), createdBy: 1 }],
      published: { all: 1 },
    });

    await DocumentDB.create('context', '/org/context',     'context', makeCtx(), [], 1);
    await DocumentDB.create('context', '/org/a/context',   'context', makeCtx(), [], 1);
    const deepId = await DocumentDB.create('context', '/org/a/b/context', 'context', makeCtx(), [], 1);

    const { data: [deepCtx] } = await FilesAPI.loadFiles([deepId], viewer);
    const content = deepCtx.content as ContextContent;

    // Despite three levels of whitelist:'*' pass-through, schema is intact
    const duckdb = content.fullSchema!.find(db => db.databaseName === 'duckdb_main');
    expect(duckdb).toBeDefined();
    const tables = duckdb!.schemas[0].tables.map(t => t.table).sort();
    expect(tables).toEqual(['orders', 'users']);

    mockGetSchemaFromPython.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11–12  Delete protection
// ─────────────────────────────────────────────────────────────────────────────

describe('Delete protection', () => {
  beforeEach(async () => {
    const { getAdapter } = await import('@/lib/database/adapter/factory');
    const db = await getAdapter();
    await db.query('DELETE FROM files WHERE company_id = $1', [1]);
  });

  // ── Test 11: standalone context deletion is blocked ───────────────────────

  it('standalone deletion of a context file throws AccessPermissionError', async () => {
    const ctxId = await DocumentDB.create('context', '/org/myteam/context', 'context',
      makeDefaultContextContent(1), [], 1);

    await expect(
      FilesAPI.deleteFile(ctxId, admin)
    ).rejects.toThrow(); // exact message: "critical system files"
  });

  it('standalone context deletion is blocked for all roles', async () => {
    const ctxId = await DocumentDB.create('context', '/org/viewer-team/context', 'context',
      makeDefaultContextContent(1), [], 1);

    await expect(FilesAPI.deleteFile(ctxId, viewer)).rejects.toThrow();
    await expect(FilesAPI.deleteFile(ctxId, admin)).rejects.toThrow();
  });

  // ── Test 12: folder deletion cascades and removes its context ─────────────

  it('deleting a folder also deletes its contained context (cascade succeeds)', async () => {
    // Create folder + its default context
    const folderId = await DocumentDB.create('folder', '/org/removable-team', 'folder',
      { description: '' }, [], 1);
    await DocumentDB.create('context', '/org/removable-team/context', 'context',
      makeDefaultContextContent(1), [], 1);

    // Folder deletion MUST succeed even though the folder contains a context
    await expect(FilesAPI.deleteFile(folderId, admin)).resolves.toBeDefined();

    // Both folder and context are gone
    expect(await DocumentDB.getByPath('/org/removable-team', 1)).toBeNull();
    expect(await DocumentDB.getByPath('/org/removable-team/context', 1)).toBeNull();
  });

  it('deleting a nested folder deletes all child contexts in the subtree', async () => {
    // Folder tree: /org/parent → /org/parent/child, each with a context
    const parentId = await DocumentDB.create('folder', '/org/parent', 'folder', { description: '' }, [], 1);
    await DocumentDB.create('folder',  '/org/parent/child',         'folder',  { description: '' }, [], 1);
    await DocumentDB.create('context', '/org/parent/context',       'context', makeDefaultContextContent(1), [], 1);
    await DocumentDB.create('context', '/org/parent/child/context', 'context', makeDefaultContextContent(1), [], 1);

    await expect(FilesAPI.deleteFile(parentId, admin)).resolves.toBeDefined();

    expect(await DocumentDB.getByPath('/org/parent', 1)).toBeNull();
    expect(await DocumentDB.getByPath('/org/parent/child', 1)).toBeNull();
    expect(await DocumentDB.getByPath('/org/parent/context', 1)).toBeNull();
    expect(await DocumentDB.getByPath('/org/parent/child/context', 1)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13–14  V33 migration
// ─────────────────────────────────────────────────────────────────────────────

describe('V33 migration', () => {
  const v33 = MIGRATIONS.find(m => m.dataVersion === 33);

  it('V33 migration entry exists in MIGRATIONS array', () => {
    expect(v33).toBeDefined();
    expect(v33!.dataMigration).toBeInstanceOf(Function);
  });

  // ── Test 13: converts old databases[] format → new whitelist tree ─────────

  it("converts old ContextVersion.databases[] to ContextVersion.whitelist WhitelistNode[]", () => {
    expect(v33!.dataMigration).toBeDefined();

    const inputData: any = {
      version: 32,
      companies: [{
        id: 1,
        name: 'test',
        users: [],
        documents: [
          {
            id: 1, name: 'context', path: '/org/context', type: 'context',
            references: [], company_id: 1,
            created_at: '2024-01-01', updated_at: '2024-01-01',
            version: 1, last_edit_id: null,
            content: {
              versions: [{
                version: 1,
                databases: [
                  {
                    databaseName: 'conn_a',
                    whitelist: [
                      { name: 'public',  type: 'schema' },                                  // whole schema (no table filter)
                      { name: 'users',   type: 'table',  schema: 'analytics' },             // single table
                      { name: 'restricted', type: 'table', schema: 'analytics',
                        childPaths: ['/org/team_a'] },                                      // table with childPaths (same schema as 'users')
                    ],
                  },
                ],
                docs: [],
                createdAt: '2024-01-01',
                createdBy: 1,
              }],
              published: { all: 1 },
            },
          },
          // A folder without a context (V33 should add one)
          {
            id: 2, name: 'sales', path: '/org/sales', type: 'folder',
            references: [], company_id: 1,
            created_at: '2024-01-01', updated_at: '2024-01-01',
            version: 1, last_edit_id: null,
            content: { description: '' },
          },
        ],
      }],
    };

    const result = v33!.dataMigration!(inputData);
    const company = result.companies[0] as any;

    // ── Test 13: whitelist format conversion ──
    const orgCtx = company.documents.find((d: any) => d.path === '/org/context');
    expect(orgCtx).toBeDefined();

    const convertedVersion = orgCtx.content.versions[0];
    // Old 'databases' field must be gone
    expect(convertedVersion.databases).toBeUndefined();
    // New 'whitelist' field must be present
    expect(convertedVersion.whitelist).toBeDefined();
    expect(Array.isArray(convertedVersion.whitelist)).toBe(true);

    const connNode = convertedVersion.whitelist.find((n: any) => n.name === 'conn_a');
    expect(connNode).toBeDefined();
    expect(connNode.type).toBe('connection');
    expect(Array.isArray(connNode.children)).toBe(true);

    // The 'public' schema entry (type:schema) becomes a schema child node
    const publicNode = connNode.children.find((n: any) => n.name === 'public' && n.type === 'schema');
    expect(publicNode).toBeDefined();
    // No further children on publicNode (whole schema) → children:undefined or no children property
    expect(publicNode.children === undefined || publicNode.children === null).toBe(true);

    // The 'users' table from 'analytics' schema → analytics node with a users child
    const analyticsNode = connNode.children.find((n: any) => n.name === 'analytics' && n.type === 'schema');
    expect(analyticsNode).toBeDefined();
    expect(Array.isArray(analyticsNode.children)).toBe(true);
    const usersTableNode = analyticsNode.children.find((n: any) => n.name === 'users' && n.type === 'table');
    expect(usersTableNode).toBeDefined();

    // The 'restricted' table with childPaths → childPaths preserved on the schema or table node
    // (exact placement depends on implementation, but childPaths must be preserved somewhere)
    const restrictedNode = connNode.children
      .flatMap((n: any) => n.children ?? [])
      .find((n: any) => n.name === 'restricted');
    expect(restrictedNode?.childPaths).toEqual(['/org/team_a']);
  });

  // ── Test 14: creates default context for folders that lack one ────────────

  it('creates default context (whitelist:*) for every folder without an existing context', () => {
    expect(v33!.dataMigration).toBeDefined();

    const inputData: any = {
      version: 32,
      companies: [{
        id: 1,
        name: 'test',
        users: [],
        documents: [
          // Two folders with NO context files
          {
            id: 1, name: 'org', path: '/org', type: 'folder',
            references: [], company_id: 1,
            created_at: '2024-01-01', updated_at: '2024-01-01', version: 1, last_edit_id: null,
            content: { description: '' },
          },
          {
            id: 2, name: 'sales', path: '/org/sales', type: 'folder',
            references: [], company_id: 1,
            created_at: '2024-01-01', updated_at: '2024-01-01', version: 1, last_edit_id: null,
            content: { description: '' },
          },
          // A folder that already has a context (should not get a duplicate)
          {
            id: 3, name: 'database', path: '/org/database', type: 'folder',
            references: [], company_id: 1,
            created_at: '2024-01-01', updated_at: '2024-01-01', version: 1, last_edit_id: null,
            content: { description: '' },
          },
          {
            id: 4, name: 'context', path: '/org/database/context', type: 'context',
            references: [], company_id: 1,
            created_at: '2024-01-01', updated_at: '2024-01-01', version: 1, last_edit_id: null,
            content: {
              versions: [{ version: 1, whitelist: '*', docs: [], createdAt: '2024-01-01', createdBy: 1 }],
              published: { all: 1 },
            },
          },
        ],
      }],
    };

    const result = v33!.dataMigration!(inputData);
    const docs = (result.companies[0] as any).documents;

    // /org/context must now exist
    const orgCtx = docs.find((d: any) => d.path === '/org/context');
    expect(orgCtx).toBeDefined();
    expect(orgCtx.type).toBe('context');
    expect(orgCtx.content.versions[0].whitelist).toBe('*');

    // /org/sales/context must now exist
    const salesCtx = docs.find((d: any) => d.path === '/org/sales/context');
    expect(salesCtx).toBeDefined();
    expect(salesCtx.type).toBe('context');
    expect(salesCtx.content.versions[0].whitelist).toBe('*');

    // /org/database/context must NOT be duplicated — still exactly one
    const dbCtxs = docs.filter((d: any) => d.path === '/org/database/context');
    expect(dbCtxs).toHaveLength(1);

    // IDs must not collide
    const allIds: number[] = docs.map((d: any) => d.id);
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(allIds.length);
  });

  it('V33 migration is idempotent: running twice produces no duplicates', () => {
    expect(v33!.dataMigration).toBeDefined();

    const inputData: any = {
      version: 32,
      companies: [{
        id: 1,
        name: 'test',
        users: [],
        documents: [
          {
            id: 1, name: 'org', path: '/org', type: 'folder',
            references: [], company_id: 1,
            created_at: '2024-01-01', updated_at: '2024-01-01', version: 1, last_edit_id: null,
            content: { description: '' },
          },
        ],
      }],
    };

    const afterFirst = v33!.dataMigration!(inputData);
    const afterSecond = v33!.dataMigration!(afterFirst);

    const orgCtxs = (afterSecond.companies[0] as any).documents.filter(
      (d: any) => d.path === '/org/context'
    );
    expect(orgCtxs).toHaveLength(1);
  });
});
