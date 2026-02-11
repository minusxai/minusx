/**
 * Context Loader Integration Tests with Versioning
 *
 * Tests custom loaders for versioned context files:
 * - Connection loader adds schema via introspection
 * - Context loader computes fullSchema from published version
 * - User-specific vs global published versions
 * - Parent-child inheritance with versioning
 *
 * Run: npm test -- context-loader.test.ts
 */

import { DocumentDB } from '@/lib/database/documents-db';
import { FilesAPI } from '@/lib/data/files.server';
import {
  initTestDatabase,
  cleanupTestDatabase,
  getTestDbPath
} from '@/store/__tests__/test-utils';
import type {
  ConnectionContent,
  ContextContent,
  DatabaseContext,
  ContextVersion,
  DatabaseSchema
} from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import * as pythonBackend from '@/lib/backend/python-backend';

// Database-specific mock
jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_context_loader.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const
  };
});

const TEST_DB_PATH = getTestDbPath('context_loader');

// Mock getSchemaFromPython to bypass unstable_cache
const mockGetSchemaFromPython = jest.spyOn(pythonBackend, 'getSchemaFromPython');

// Test users
const adminUser: EffectiveUser = {
  userId: 1,
  name: 'Admin User',
  email: 'admin@example.com',
  role: 'admin',
  companyId: 1,
  companyName: 'test-company',
  mode: 'org',
  home_folder: ''
};

const nonAdminUser: EffectiveUser = {
  userId: 2,
  name: 'Regular User',
  email: 'user@example.com',
  role: 'viewer',
  companyId: 1,
  companyName: 'test-company',
  mode: 'org',
  home_folder: ''
};

const adminUser4: EffectiveUser = {
  userId: 4,
  name: 'Admin User 4',
  email: 'admin4@example.com',
  role: 'admin',
  companyId: 1,
  companyName: 'test-company',
  mode: 'org',
  home_folder: ''
};

describe('Context Loader Integration with Versioning', () => {
  let duckdbConnectionId: number;
  let bigqueryConnectionId: number;
  let orgContextId: number;
  let salesContextId: number;

  beforeAll(async () => {
    // Reset adapter to ensure fresh connection
    const { resetAdapter } = await import('@/lib/database/adapter/factory');
    await resetAdapter();

    await initTestDatabase(TEST_DB_PATH);
  });

  afterAll(async () => {
    await cleanupTestDatabase(TEST_DB_PATH);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockGetSchemaFromPython.mockClear();

    // Clean up existing test data
    const { getAdapter } = await import('@/lib/database/adapter/factory');
    const db = await getAdapter();
    await db.query('DELETE FROM files WHERE company_id = $1', [1]);

    // Mock getSchemaFromPython to return schemas directly
    mockGetSchemaFromPython.mockImplementation((name: string) => {
      if (name === 'duckdb_main') {
        return Promise.resolve({
          schemas: [{
            schema: 'public',
            tables: [
              {
                table: 'users',
                columns: [
                  { name: 'id', type: 'INTEGER' },
                  { name: 'email', type: 'VARCHAR' }
                ]
              },
              {
                table: 'orders',
                columns: [
                  { name: 'id', type: 'INTEGER' },
                  { name: 'user_id', type: 'INTEGER' },
                  { name: 'amount', type: 'DECIMAL' }
                ]
              },
              {
                table: 'products',
                columns: [
                  { name: 'id', type: 'INTEGER' },
                  { name: 'name', type: 'VARCHAR' }
                ]
              }
            ]
          }]
        } as DatabaseSchema);
      }

      if (name === 'bigquery_analytics') {
        return Promise.resolve({
          schemas: [{
            schema: 'analytics',
            tables: [
              {
                table: 'events',
                columns: [
                  { name: 'event_id', type: 'STRING' },
                  { name: 'user_id', type: 'STRING' },
                  { name: 'timestamp', type: 'TIMESTAMP' }
                ]
              }
            ]
          }]
        } as DatabaseSchema);
      }

      return Promise.resolve({ schemas: [], updated_at: new Date().toISOString() } as DatabaseSchema);
    });

    // Create 2 connection files
    const duckdbContent: ConnectionContent = {
      type: 'duckdb',
      config: { file_path: '../data/test.duckdb' },
      description: 'Test DuckDB'
    };

    const bigqueryContent: ConnectionContent = {
      type: 'bigquery',
      config: { project_id: 'test-project' },
      description: 'Test BigQuery'
    };

    duckdbConnectionId = await DocumentDB.create(
      'duckdb_main',
      '/org/database/duckdb_main',
      'connection',
      duckdbContent,
      [],
      1
    );

    bigqueryConnectionId = await DocumentDB.create(
      'bigquery_analytics',
      '/org/database/bigquery_analytics',
      'connection',
      bigqueryContent,
      [],
      1
    );

    // Create versioned context files

    // /org/context - Root context with multiple versions
    const orgVersion1: ContextVersion = {
      version: 1,
      databases: [
        {
          databaseName: 'duckdb_main',
          whitelist: [{ name: 'public', type: 'schema' }]  // All tables
        }
      ],
      docs: [{ content: 'Version 1: Full public schema' }],
      createdAt: new Date().toISOString(),
      createdBy: 1,
      description: 'Initial version with full schema'
    };

    const orgVersion2: ContextVersion = {
      version: 2,
      databases: [
        {
          databaseName: 'duckdb_main',
          whitelist: [
            { name: 'users', type: 'table', schema: 'public' },
            { name: 'orders', type: 'table', schema: 'public' }
          ]  // Only users and orders
        },
        {
          databaseName: 'bigquery_analytics',
          whitelist: [{ name: 'events', type: 'table', schema: 'analytics' }]
        }
      ],
      docs: [{ content: 'Version 2: Restricted schema + BigQuery' }],
      createdAt: new Date().toISOString(),
      createdBy: 4,
      description: 'Testing version with restricted schema'
    };

    const orgContent: ContextContent = {
      versions: [orgVersion1, orgVersion2],
      published: {
        all: 1      // Everyone sees version 1
      },
      fullSchema: [],
      fullDocs: []
    };

    orgContextId = await DocumentDB.create(
      'context',
      '/org/context',
      'context',
      orgContent,
      [],
      1
    );

    // /org/sales/context - Child context
    const salesVersion1: ContextVersion = {
      version: 1,
      databases: [
        {
          databaseName: 'duckdb_main',
          whitelist: [
            { name: 'users', type: 'table', schema: 'public' }  // Only users
          ]
        }
      ],
      docs: [{ content: 'Sales context v1' }],
      createdAt: new Date().toISOString(),
      createdBy: 1,
      description: 'Sales team context'
    };

    const salesContent: ContextContent = {
      versions: [salesVersion1],
      published: { all: 1 },
      fullSchema: [],
      fullDocs: []
    };

    salesContextId = await DocumentDB.create(
      'context',
      '/org/sales/context',
      'context',
      salesContent,
      [],
      1
    );
  });

  describe('Root Context - Version Resolution', () => {
    it('should load published version for non-admin users', async () => {
      // Non-admin loads context → should see version 1 (published.all)
      const { data: contexts } = await FilesAPI.loadFiles([orgContextId], nonAdminUser);
      const content = contexts[0].content as ContextContent;

      // Non-admin should only see their published version
      expect(content.versions).toHaveLength(1);
      expect(content.versions![0].version).toBe(1);
      expect(content.published).toEqual({ all: 1 });

      // fullSchema computed from version 1 (full public schema)
      const duckdb = content.fullSchema!.find(db => db.databaseName === 'duckdb_main');
      expect(duckdb).toBeDefined();
      expect(duckdb!.schemas[0].tables).toHaveLength(3); // users, orders, products
      expect(duckdb!.schemas[0].tables.map(t => t.table).sort()).toEqual(['orders', 'products', 'users']);
    });

    it('should load user-specific published version for admin with override', async () => {
      // Admin user 4 loads context → should see version 2 (user-specific override)
      const { data: contexts } = await FilesAPI.loadFiles([orgContextId], adminUser4);
      const content = contexts[0].content as ContextContent;

      // Admin sees all versions
      expect(content.versions).toHaveLength(2);

      // fullSchema shows ALL available schema (unfiltered)
      // For root contexts, fullSchema = all connection schemas regardless of version's whitelist
      const duckdb = content.fullSchema!.find(db => db.databaseName === 'duckdb_main');
      expect(duckdb).toBeDefined();
      expect(duckdb!.schemas[0].tables).toHaveLength(3); // All tables: users, orders, products
      expect(duckdb!.schemas[0].tables.map(t => t.table).sort()).toEqual(['orders', 'products', 'users']);

      const bigquery = content.fullSchema!.find(db => db.databaseName === 'bigquery_analytics');
      expect(bigquery).toBeDefined();
      expect(bigquery!.schemas[0].tables).toHaveLength(1); // events
      expect(bigquery!.schemas[0].tables[0].table).toBe('events');
    });

    it('should fallback to published.all for admin without user-specific version', async () => {
      // Admin user 1 loads context → no user-specific override, falls back to published.all
      const { data: contexts } = await FilesAPI.loadFiles([orgContextId], adminUser);
      const content = contexts[0].content as ContextContent;

      // Admin sees all versions
      expect(content.versions).toHaveLength(2);

      // fullSchema computed from version 1 (published.all)
      const duckdb = content.fullSchema!.find(db => db.databaseName === 'duckdb_main');
      expect(duckdb).toBeDefined();
      expect(duckdb!.schemas[0].tables).toHaveLength(3); // all tables
      expect(duckdb!.schemas[0].tables.map(t => t.table).sort()).toEqual(['orders', 'products', 'users']);
    });
  });

  describe('Child Context - Parent Versioning Inheritance', () => {
    it('should inherit parent schema based on parent published version (non-admin)', async () => {
      // Non-admin loads child context
      // Parent is at version 1 (all of public schema available)
      // Child whitelists only users table
      const { data: contexts } = await FilesAPI.loadFiles([salesContextId], nonAdminUser);
      const content = contexts[0].content as ContextContent;

      // Non-admin sees only their version
      expect(content.versions).toHaveLength(1);
      expect(content.versions![0].version).toBe(1);

      // fullSchema filtered by parent's version 1 schema (all tables available)
      // fullSchema represents what's AVAILABLE to child, not what child whitelisted
      const duckdb = content.fullSchema!.find(db => db.databaseName === 'duckdb_main');
      expect(duckdb).toBeDefined();
      expect(duckdb!.schemas[0].tables).toHaveLength(3); // All tables from parent
      expect(duckdb!.schemas[0].tables.map(t => t.table).sort()).toEqual(['orders', 'products', 'users']);

      // fullDocs inherited from parent's version 1
      expect(content.fullDocs).toEqual([{ content: 'Version 1: Full public schema' }]);
    });

    it('should inherit parent schema based on published version (admin sees same as non-admin)', async () => {
      // Admin user 4 loads child context
      // Parent is at version 1 for all users (no more user-specific overrides)
      // Child whitelists only users table
      const { data: contexts } = await FilesAPI.loadFiles([salesContextId], adminUser4);
      const content = contexts[0].content as ContextContent;

      // Admin sees all versions
      expect(content.versions).toHaveLength(1);

      // fullSchema filtered by parent's version 1 schema (all tables available)
      // fullSchema represents what's AVAILABLE to child, not what child whitelisted
      const duckdb = content.fullSchema!.find(db => db.databaseName === 'duckdb_main');
      expect(duckdb).toBeDefined();
      expect(duckdb!.schemas[0].tables).toHaveLength(3); // All tables from parent
      expect(duckdb!.schemas[0].tables.map(t => t.table).sort()).toEqual(['orders', 'products', 'users']);

      // fullDocs inherited from parent's version 1 (same as non-admin)
      expect(content.fullDocs).toEqual([{ content: 'Version 1: Full public schema' }]);
    });
  });

  describe('Error Handling', () => {
    it('should throw error when context has no versions', async () => {
      // Create context without versions (legacy format without migration)
      const legacyContent: any = {
        databases: [],
        docs: [],
        fullSchema: [],
        fullDocs: []
      };

      const legacyContextId = await DocumentDB.create(
        'legacy_context',
        '/org/legacy_context',
        'context',
        legacyContent,
        [],
        1
      );

      await expect(
        FilesAPI.loadFiles([legacyContextId], adminUser)
      ).rejects.toThrow('Context has no versions');
    });

    it('should throw error when published version does not exist', async () => {
      // Create context with published version that doesn't exist
      const invalidContent: ContextContent = {
        versions: [
          {
            version: 1,
            databases: [],
            docs: [],
            createdAt: new Date().toISOString(),
            createdBy: 1,
            description: 'Version 1'
          }
        ],
        published: { all: 99 },  // Version 99 doesn't exist
        fullSchema: [],
        fullDocs: []
      };

      const invalidContextId = await DocumentDB.create(
        'invalid_context',
        '/org/invalid_context',
        'context',
        invalidContent,
        [],
        1
      );

      await expect(
        FilesAPI.loadFiles([invalidContextId], adminUser)
      ).rejects.toThrow('Published version 99 not found');
    });
  });

  describe('Version Gaps', () => {
    it('should handle version gaps correctly (1, 2, 5)', async () => {
      // Create context with version gaps
      const gappedContent: ContextContent = {
        versions: [
          {
            version: 1,
            databases: [{ databaseName: 'duckdb_main', whitelist: [{ name: 'users', type: 'table', schema: 'public' }] }],
            docs: [{ content: 'V1' }],
            createdAt: new Date().toISOString(),
            createdBy: 1,
            description: 'Version 1'
          },
          {
            version: 2,
            databases: [{ databaseName: 'duckdb_main', whitelist: [{ name: 'orders', type: 'table', schema: 'public' }] }],
            docs: [{ content: 'V2' }],
            createdAt: new Date().toISOString(),
            createdBy: 1,
            description: 'Version 2'
          },
          {
            version: 5,
            databases: [{ databaseName: 'duckdb_main', whitelist: [{ name: 'products', type: 'table', schema: 'public' }] }],
            docs: [{ content: 'V5' }],
            createdAt: new Date().toISOString(),
            createdBy: 1,
            description: 'Version 5'
          }
        ],
        published: { all: 5 },
        fullSchema: [],
        fullDocs: []
      };

      const gappedContextId = await DocumentDB.create(
        'gapped_context',
        '/org/gapped_context',
        'context',
        gappedContent,
        [],
        1
      );

      const { data: contexts } = await FilesAPI.loadFiles([gappedContextId], nonAdminUser);
      const content = contexts[0].content as ContextContent;

      // Should load version 5 (published.all)
      expect(content.versions![0].version).toBe(5);

      // fullSchema shows ALL available schema (unfiltered) regardless of version
      const duckdb = content.fullSchema!.find(db => db.databaseName === 'duckdb_main');
      expect(duckdb).toBeDefined();
      expect(duckdb!.schemas[0].tables).toHaveLength(3); // All tables available
      expect(duckdb!.schemas[0].tables.map(t => t.table).sort()).toEqual(['orders', 'products', 'users']);
    });
  });

  describe('Path-based whitelist inheritance', () => {
    it('should filter child context by childPaths in parent whitelist', async () => {
      const companyId = 1;

      // Create parent context at /org/testing with childPaths
      // This inherits from /org/context (which has fullSchema from connections)
      const parentContextId = await DocumentDB.create(
        'context',
        '/org/testing/context',
        'context',
        {
          versions: [{
            version: 1,
            databases: [{
              databaseName: 'duckdb_main',
              whitelist: [
                { name: 'users', type: 'table', schema: 'public', childPaths: ['/org/testing/sales'] },
                { name: 'orders', type: 'table', schema: 'public', childPaths: ['/org/testing/marketing'] }
              ]
            }],
            docs: [{ content: 'Parent context' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        [],
        companyId
      );

      // Create child context at /org/testing/sales (should see users, not orders)
      const salesContextId = await DocumentDB.create(
        'context',
        '/org/testing/sales/context',
        'context',
        {
          versions: [{
            version: 1,
            databases: [{
              databaseName: 'duckdb_main',
              whitelist: [
                { name: 'users', type: 'table', schema: 'public' }
              ]
            }],
            docs: [{ content: 'Sales context' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        [],
        companyId
      );

      // Create child context at /org/testing/marketing (should see orders, not users)
      const marketingContextId = await DocumentDB.create(
        'context',
        '/org/testing/marketing/context',
        'context',
        {
          versions: [{
            version: 1,
            databases: [{
              databaseName: 'duckdb_main',
              whitelist: [
                { name: 'orders', type: 'table', schema: 'public' }
              ]
            }],
            docs: [{ content: 'Marketing context' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        [],
        companyId
      );

      // Load sales child context
      const { data: salesContexts } = await FilesAPI.loadFiles([salesContextId], nonAdminUser);
      const salesContent = salesContexts[0].content as ContextContent;

      // Should see users table (from childPaths: ['/org/sales'])
      expect(salesContent.fullSchema).toBeDefined();
      const salesDb = salesContent.fullSchema!.find(d => d.databaseName === 'duckdb_main');
      expect(salesDb).toBeDefined();
      const salesTables = salesDb!.schemas[0].tables.map(t => t.table);
      expect(salesTables).toContain('users');
      expect(salesTables).not.toContain('orders');

      // Load marketing child context
      const { data: marketingContexts } = await FilesAPI.loadFiles([marketingContextId], nonAdminUser);
      const marketingContent = marketingContexts[0].content as ContextContent;

      // Should see orders table (from childPaths: ['/org/marketing'])
      expect(marketingContent.fullSchema).toBeDefined();
      const marketingDb = marketingContent.fullSchema!.find(d => d.databaseName === 'duckdb_main');
      expect(marketingDb).toBeDefined();
      const marketingTables = marketingDb!.schemas[0].tables.map(t => t.table);
      expect(marketingTables).toContain('orders');
      expect(marketingTables).not.toContain('users');
    });

    it('should apply to all children when childPaths is undefined', async () => {
      const companyId = 1;

      // Create parent context without childPaths (applies to all)
      const parentContextId = await DocumentDB.create(
        'context',
        '/org/testing2/context',
        'context',
        {
          versions: [{
            version: 1,
            databases: [{
              databaseName: 'duckdb_main',
              whitelist: [
                { name: 'products', type: 'table', schema: 'public' } // No childPaths
              ]
            }],
            docs: [{ content: 'Parent context' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        [],
        companyId
      );

      // Create child contexts
      const child1Id = await DocumentDB.create(
        'context',
        '/org/testing2/team1/context',
        'context',
        {
          versions: [{
            version: 1,
            databases: [{
              databaseName: 'duckdb_main',
              whitelist: [
                { name: 'products', type: 'table', schema: 'public' }
              ]
            }],
            docs: [{ content: 'Child 1' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        [],
        companyId
      );

      const child2Id = await DocumentDB.create(
        'context',
        '/org/testing2/team2/context',
        'context',
        {
          versions: [{
            version: 1,
            databases: [{
              databaseName: 'duckdb_main',
              whitelist: [
                { name: 'products', type: 'table', schema: 'public' }
              ]
            }],
            docs: [{ content: 'Child 2' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        [],
        companyId
      );

      // Both children should see products table
      const { data: [child1] } = await FilesAPI.loadFiles([child1Id], nonAdminUser);
      const { data: [child2] } = await FilesAPI.loadFiles([child2Id], nonAdminUser);

      const child1Content = child1.content as ContextContent;
      const child2Content = child2.content as ContextContent;

      const child1Tables = child1Content.fullSchema![0].schemas[0].tables.map(t => t.table);
      const child2Tables = child2Content.fullSchema![0].schemas[0].tables.map(t => t.table);

      expect(child1Tables).toContain('products');
      expect(child2Tables).toContain('products');
    });

    it('should support nested path matching (startsWith)', async () => {
      const companyId = 1;

      // Create parent context with childPaths: ['/org/testing3/sales']
      const parentContextId = await DocumentDB.create(
        'context',
        '/org/testing3/context',
        'context',
        {
          versions: [{
            version: 1,
            databases: [{
              databaseName: 'duckdb_main',
              whitelist: [
                { name: 'users', type: 'table', schema: 'public', childPaths: ['/org/testing3/sales'] }
              ]
            }],
            docs: [{ content: 'Parent context' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        [],
        companyId
      );

      // Create nested child at /org/testing3/sales/north/context
      const nestedChildId = await DocumentDB.create(
        'context',
        '/org/testing3/sales/north/context',
        'context',
        {
          versions: [{
            version: 1,
            databases: [{
              databaseName: 'duckdb_main',
              whitelist: [
                { name: 'users', type: 'table', schema: 'public' }
              ]
            }],
            docs: [{ content: 'Nested child' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        [],
        companyId
      );

      // Create unrelated child at /org/testing3/marketing/context
      const unrelatedChildId = await DocumentDB.create(
        'context',
        '/org/testing3/marketing/context',
        'context',
        {
          versions: [{
            version: 1,
            databases: [{
              databaseName: 'duckdb_main',
              whitelist: [
                // Empty whitelist - should have no tables since parent restricts access
              ]
            }],
            docs: [{ content: 'Unrelated child' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        [],
        companyId
      );

      // Nested child should see users (path matches /org/sales/*)
      const { data: [nestedChild] } = await FilesAPI.loadFiles([nestedChildId], nonAdminUser);
      const nestedContent = nestedChild.content as ContextContent;
      const nestedTables = nestedContent.fullSchema![0].schemas[0].tables.map(t => t.table);
      expect(nestedTables).toContain('users');

      // Unrelated child should NOT see users (path doesn't match /org/sales/*)
      // Since parent only whitelists users, unrelated child should have empty fullSchema
      const { data: [unrelatedChild] } = await FilesAPI.loadFiles([unrelatedChildId], nonAdminUser);
      const unrelatedContent = unrelatedChild.content as ContextContent;

      expect(unrelatedContent.fullSchema).toBeDefined();
      const unrelatedDb = unrelatedContent.fullSchema!.find(d => d.databaseName === 'duckdb_main');

      // Either no database or no tables (users was filtered out by childPaths)
      if (unrelatedDb) {
        expect(unrelatedDb.schemas.length === 0 || unrelatedDb.schemas[0].tables.length === 0).toBe(true);
      } else {
        // No database at all is also acceptable
        expect(unrelatedDb).toBeUndefined();
      }
    });

    it('should support schema-level childPaths filtering', async () => {
      const companyId = 1;

      // Create parent context with schema-level childPaths
      const parentContextId = await DocumentDB.create(
        'context',
        '/org/testing4/context',
        'context',
        {
          versions: [{
            version: 1,
            databases: [{
              databaseName: 'duckdb_main',
              whitelist: [
                // Whitelist entire schema with childPaths restriction
                { name: 'public', type: 'schema', childPaths: ['/org/testing4/engineering'] }
              ]
            }],
            docs: [{ content: 'Parent with schema-level childPaths' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        [],
        companyId
      );

      // Create child at /org/testing4/engineering (should see entire schema)
      const engineeringContextId = await DocumentDB.create(
        'context',
        '/org/testing4/engineering/context',
        'context',
        {
          versions: [{
            version: 1,
            databases: [{
              databaseName: 'duckdb_main',
              whitelist: [
                { name: 'public', type: 'schema' }
              ]
            }],
            docs: [{ content: 'Engineering context' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        [],
        companyId
      );

      // Create child at /org/testing4/sales (should NOT see schema)
      const salesContextId2 = await DocumentDB.create(
        'context',
        '/org/testing4/sales/context',
        'context',
        {
          versions: [{
            version: 1,
            databases: [{
              databaseName: 'duckdb_main',
              whitelist: []
            }],
            docs: [{ content: 'Sales context' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        [],
        companyId
      );

      // Engineering child should see all tables from public schema
      const { data: [engChild] } = await FilesAPI.loadFiles([engineeringContextId], nonAdminUser);
      const engContent = engChild.content as ContextContent;
      expect(engContent.fullSchema).toBeDefined();
      const engDb = engContent.fullSchema!.find(d => d.databaseName === 'duckdb_main');
      expect(engDb).toBeDefined();
      const engTables = engDb!.schemas[0].tables.map(t => t.table).sort();
      // Should have all tables in public schema
      expect(engTables).toContain('users');
      expect(engTables).toContain('orders');
      expect(engTables).toContain('products');

      // Sales child should NOT see any tables (schema filtered out by childPaths)
      const { data: [salesChild] } = await FilesAPI.loadFiles([salesContextId2], nonAdminUser);
      const salesContent = salesChild.content as ContextContent;
      expect(salesContent.fullSchema).toBeDefined();
      const salesDb = salesContent.fullSchema!.find(d => d.databaseName === 'duckdb_main');
      // Either no database or no schemas/tables
      if (salesDb) {
        expect(salesDb.schemas.length === 0 || salesDb.schemas[0].tables.length === 0).toBe(true);
      } else {
        expect(salesDb).toBeUndefined();
      }
    });

    it('CRITICAL: child fullSchema must respect PARENT whitelist childPaths, not child whitelist', async () => {
      // This test catches the bug where we filtered by child's whitelist instead of parent's
      const companyId = 1;

      // Parent whitelists tables with childPaths
      const parentContextId = await DocumentDB.create(
        'context',
        '/org/testing5/context',
        'context',
        {
          versions: [{
            version: 1,
            databases: [{
              databaseName: 'duckdb_main',
              whitelist: [
                { name: 'users', type: 'table', schema: 'public', childPaths: ['/org/testing5/team_a'] },
                { name: 'orders', type: 'table', schema: 'public', childPaths: ['/org/testing5/team_b'] }
              ]
            }],
            docs: [{ content: 'Parent with childPaths' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        [],
        companyId
      );

      // Child at /org/testing5/team_a with DIFFERENT whitelist (whitelists orders, not users)
      // But parent only allows users for this path!
      const teamAContextId = await DocumentDB.create(
        'context',
        '/org/testing5/team_a/context',
        'context',
        {
          versions: [{
            version: 1,
            databases: [{
              databaseName: 'duckdb_main',
              whitelist: [
                // Child WANTS orders, but parent restricts this path to users only
                { name: 'orders', type: 'table', schema: 'public' }
              ]
            }],
            docs: [{ content: 'Team A context' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        [],
        companyId
      );

      // Load child context
      const { data: [teamAChild] } = await FilesAPI.loadFiles([teamAContextId], nonAdminUser);
      const teamAContent = teamAChild.content as ContextContent;

      // CRITICAL: fullSchema should contain ONLY 'users' (what parent allows for this path)
      // Even though child's whitelist says 'orders', parent restricts this path to 'users'
      expect(teamAContent.fullSchema).toBeDefined();
      const teamADb = teamAContent.fullSchema!.find(d => d.databaseName === 'duckdb_main');
      expect(teamADb).toBeDefined();

      const teamATables = teamADb!.schemas[0].tables.map(t => t.table);

      // Must have 'users' (allowed by parent for this path)
      expect(teamATables).toContain('users');

      // Must NOT have 'orders' (parent restricts to /org/team_b only)
      expect(teamATables).not.toContain('orders');

      // Must NOT have 'products' (not in parent whitelist at all)
      expect(teamATables).not.toContain('products');
    });

    it('E2E: child can only whitelist from parent-allowed fullSchema', async () => {
      // Test the complete flow: parent restricts → child loads → child can only select allowed tables
      const companyId = 1;

      // Parent restricts severely
      const parentContextId = await DocumentDB.create(
        'context',
        '/org/testing6/context',
        'context',
        {
          versions: [{
            version: 1,
            databases: [{
              databaseName: 'duckdb_main',
              whitelist: [
                { name: 'users', type: 'table', schema: 'public', childPaths: ['/org/testing6/restricted'] }
                // Only 'users' table, only for /org/testing6/restricted path
              ]
            }],
            docs: [{ content: 'Severely restricted parent' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        [],
        companyId
      );

      // Child at /org/testing6/restricted with empty whitelist initially
      const restrictedContextId = await DocumentDB.create(
        'context',
        '/org/testing6/restricted/context',
        'context',
        {
          versions: [{
            version: 1,
            databases: [{
              databaseName: 'duckdb_main',
              whitelist: [] // Empty - wants to whitelist from available
            }],
            docs: [{ content: 'Restricted child' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        [],
        companyId
      );

      // Load child
      const { data: [child] } = await FilesAPI.loadFiles([restrictedContextId], nonAdminUser);
      const childContent = child.content as ContextContent;

      // fullSchema should contain ONLY 'users' (nothing else available)
      expect(childContent.fullSchema).toBeDefined();
      const childDb = childContent.fullSchema!.find(d => d.databaseName === 'duckdb_main');
      expect(childDb).toBeDefined();
      expect(childDb!.schemas[0].tables).toHaveLength(1);
      expect(childDb!.schemas[0].tables[0].table).toBe('users');
    });

    it('E2E: sibling contexts with different childPaths see different schemas', async () => {
      // Real-world scenario: two teams, different access
      const companyId = 1;

      const parentContextId = await DocumentDB.create(
        'context',
        '/org/testing7/context',
        'context',
        {
          versions: [{
            version: 1,
            databases: [{
              databaseName: 'duckdb_main',
              whitelist: [
                { name: 'users', type: 'table', schema: 'public', childPaths: ['/org/testing7/sales', '/org/testing7/support'] },
                { name: 'orders', type: 'table', schema: 'public', childPaths: ['/org/testing7/sales'] },
                { name: 'products', type: 'table', schema: 'public', childPaths: ['/org/testing7/sales'] }
              ]
            }],
            docs: [{ content: 'Multi-team parent' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        [],
        companyId
      );

      // Sales team - should see users, orders, products
      const salesContextId = await DocumentDB.create(
        'context',
        '/org/testing7/sales/context',
        'context',
        {
          versions: [{
            version: 1,
            databases: [{ databaseName: 'duckdb_main', whitelist: [] }],
            docs: [],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        [],
        companyId
      );

      // Support team - should see ONLY users
      const supportContextId = await DocumentDB.create(
        'context',
        '/org/testing7/support/context',
        'context',
        {
          versions: [{
            version: 1,
            databases: [{ databaseName: 'duckdb_main', whitelist: [] }],
            docs: [],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        [],
        companyId
      );

      // Load both siblings
      const { data: [sales, support] } = await FilesAPI.loadFiles([salesContextId, supportContextId], nonAdminUser);

      const salesTables = (sales.content as ContextContent).fullSchema![0].schemas[0].tables.map(t => t.table).sort();
      const supportTables = (support.content as ContextContent).fullSchema![0].schemas[0].tables.map(t => t.table).sort();

      // Sales sees all three tables
      expect(salesTables).toEqual(['orders', 'products', 'users']);

      // Support sees only users
      expect(supportTables).toEqual(['users']);
    });
  });
});
