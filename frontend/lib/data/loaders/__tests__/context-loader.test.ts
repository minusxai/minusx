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
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';
import { getModules } from '@/lib/modules/registry';
import type {
  ConnectionContent,
  ContextContent,
  ContextVersion,
  DatabaseSchema,
  QuestionContent,
  DocumentContent
} from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import * as pythonBackend from '@/lib/backend/python-backend.server';

// Mock Node.js connector so schema falls through to getSchemaFromPython mock below
jest.mock('@/lib/connections', () => ({
  getNodeConnector: () => null,
}));

// Database-specific mock
jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

const TEST_DB_PATH = getTestDbPath('context_loader');

// Mock getSchemaFromPython to bypass unstable_cache
const mockGetSchemaFromPython = jest.spyOn(pythonBackend, 'getSchemaFromPython');

// Test users
const adminUser: EffectiveUser = {
  userId: 1,
  name: 'Admin User',
  email: 'admin@example.com',
  role: 'admin',
  mode: 'org',
  home_folder: ''
};

const nonAdminUser: EffectiveUser = {
  userId: 2,
  name: 'Regular User',
  email: 'user@example.com',
  role: 'viewer',
  mode: 'org',
  home_folder: ''
};

const adminUser4: EffectiveUser = {
  userId: 4,
  name: 'Admin User 4',
  email: 'admin4@example.com',
  role: 'admin',
  mode: 'org',
  home_folder: ''
};

/** Create and immediately publish a context file so ancestor lookups via getByPath work. */
async function mkPublishedContext(name: string, path: string, content: ContextContent): Promise<number> {
  const id = await DocumentDB.create(name, path, 'context', content, []);
  await DocumentDB.update(id, name, path, content, [], `init-${id}`);
  return id;
}

describe('Context Loader Integration with Versioning', () => {
  let duckdbConnectionId: number;
  let bigqueryConnectionId: number;
  let orgContextId: number;
  let salesContextId: number;

  setupTestDb(TEST_DB_PATH);

  beforeEach(async () => {
    mockGetSchemaFromPython.mockClear();

    // Clean up existing test data (setupTestDb already called jest.clearAllMocks())
    await getModules().db.exec('DELETE FROM files', []);

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
      []
    );
    await DocumentDB.update(duckdbConnectionId, 'duckdb_main', '/org/database/duckdb_main', duckdbContent, [], 'init-duckdb');

    bigqueryConnectionId = await DocumentDB.create(
      'bigquery_analytics',
      '/org/database/bigquery_analytics',
      'connection',
      bigqueryContent,
      []
    );
    await DocumentDB.update(bigqueryConnectionId, 'bigquery_analytics', '/org/database/bigquery_analytics', bigqueryContent, [], 'init-bigquery');

    // Create versioned context files

    // /org/context - Root context with multiple versions
    const orgVersion1: ContextVersion = {
      version: 1,
      whitelist: [
        { name: 'duckdb_main', type: 'connection', children: [
          { name: 'public', type: 'schema' }  // all tables (children undefined = expose all)
        ]}
      ],
      docs: [{ content: 'Version 1: Full public schema' }],
      createdAt: new Date().toISOString(),
      createdBy: 1,
      description: 'Initial version with full schema'
    };

    const orgVersion2: ContextVersion = {
      version: 2,
      whitelist: [
        { name: 'duckdb_main', type: 'connection', children: [
          { name: 'public', type: 'schema', children: [
            { name: 'users', type: 'table' },
            { name: 'orders', type: 'table' }
          ]}
        ]},
        { name: 'bigquery_analytics', type: 'connection', children: [
          { name: 'analytics', type: 'schema', children: [
            { name: 'events', type: 'table' }
          ]}
        ]}
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
      skills: [
        {
          name: 'parent_skill',
          description: 'Parent skill',
          content: 'Use parent guidance',
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: 1
        },
        {
          name: 'shared_skill',
          description: 'Parent shared skill',
          content: 'Use parent shared guidance',
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: 1
        }
      ],
      fullSchema: [],
      fullDocs: [],
      fullSkills: []
    };

    orgContextId = await DocumentDB.create(
      'context',
      '/org/context',
      'context',
      orgContent,
      []
    );
    await DocumentDB.update(orgContextId, 'context', '/org/context', orgContent, [], 'init-org-context');

    // /org/sales/context - Child context
    const salesVersion1: ContextVersion = {
      version: 1,
      whitelist: [
        { name: 'duckdb_main', type: 'connection', children: [
          { name: 'public', type: 'schema', children: [
            { name: 'users', type: 'table' }
          ]}
        ]}
      ],
      docs: [{ content: 'Sales context v1' }],
      createdAt: new Date().toISOString(),
      createdBy: 1,
      description: 'Sales team context'
    };

    const salesContent: ContextContent = {
      versions: [salesVersion1],
      published: { all: 1 },
      skills: [
        {
          name: 'shared_skill',
          description: 'Sales shared skill',
          content: 'Use sales shared guidance',
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: 1
        },
        {
          name: 'sales_skill',
          description: 'Sales skill',
          content: 'Use sales guidance',
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: 1
        }
      ],
      fullSchema: [],
      fullDocs: [],
      fullSkills: []
    };

    salesContextId = await DocumentDB.create(
      'context',
      '/org/sales/context',
      'context',
      salesContent,
      []
    );
    await DocumentDB.update(salesContextId, 'context', '/org/sales/context', salesContent, [], 'init-sales-context');
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

    it('should load all versions for admin users', async () => {
      // Admin user 4 loads context → sees all versions, fullSchema from published version 1
      const { data: contexts } = await FilesAPI.loadFiles([orgContextId], adminUser4);
      const content = contexts[0].content as ContextContent;

      // Admin sees all versions
      expect(content.versions).toHaveLength(2);

      // fullSchema computed from published version 1 (duckdb_main/public/all tables)
      const duckdb = content.fullSchema!.find(db => db.databaseName === 'duckdb_main');
      expect(duckdb).toBeDefined();
      expect(duckdb!.schemas[0].tables).toHaveLength(3); // users, orders, products (version 1 whitelist)
      expect(duckdb!.schemas[0].tables.map(t => t.table).sort()).toEqual(['orders', 'products', 'users']);

      // bigquery NOT in version 1's whitelist
      const bigquery = content.fullSchema!.find(db => db.databaseName === 'bigquery_analytics');
      expect(bigquery).toBeUndefined();
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

      // fullSchema = parent offering × child's own whitelist
      // Parent offers all public tables; child whitelist = users only → result is users only
      const duckdb = content.fullSchema!.find(db => db.databaseName === 'duckdb_main');
      expect(duckdb).toBeDefined();
      expect(duckdb!.schemas[0].tables).toHaveLength(1); // Only users (child's whitelist applied)
      expect(duckdb!.schemas[0].tables[0].table).toBe('users');

      // fullDocs inherited from parent's version 1
      expect(content.fullDocs).toEqual([{ content: 'Version 1: Full public schema' }]);
    });

    it('should always inherit parent skills to children', async () => {
      const { data: contexts } = await FilesAPI.loadFiles([salesContextId], nonAdminUser);
      const content = contexts[0].content as ContextContent;

      expect(content.fullSkills?.map(skill => skill.name).sort()).toEqual(['parent_skill', 'shared_skill']);
      expect(content.skills?.map(skill => skill.name).sort()).toEqual(['sales_skill', 'shared_skill']);
    });

    it('should inherit parent schema based on published version (admin sees same as non-admin)', async () => {
      // Admin user 4 loads child context
      // Parent is at version 1 for all users
      // Child whitelists only users table
      const { data: contexts } = await FilesAPI.loadFiles([salesContextId], adminUser4);
      const content = contexts[0].content as ContextContent;

      // Admin sees all versions in this child context (only 1 version)
      expect(content.versions).toHaveLength(1);

      // fullSchema = parent offering × child's own whitelist
      // Parent offers all public tables; child whitelist = users only → result is users only
      const duckdb = content.fullSchema!.find(db => db.databaseName === 'duckdb_main');
      expect(duckdb).toBeDefined();
      expect(duckdb!.schemas[0].tables).toHaveLength(1); // Only users (child's whitelist applied)
      expect(duckdb!.schemas[0].tables[0].table).toBe('users');

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
        []
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
            whitelist: [],
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
        []
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
            whitelist: [{ name: 'duckdb_main', type: 'connection', children: [
              { name: 'public', type: 'schema', children: [{ name: 'users', type: 'table' }] }
            ]}],
            docs: [{ content: 'V1' }],
            createdAt: new Date().toISOString(),
            createdBy: 1,
            description: 'Version 1'
          },
          {
            version: 2,
            whitelist: [{ name: 'duckdb_main', type: 'connection', children: [
              { name: 'public', type: 'schema', children: [{ name: 'orders', type: 'table' }] }
            ]}],
            docs: [{ content: 'V2' }],
            createdAt: new Date().toISOString(),
            createdBy: 1,
            description: 'Version 2'
          },
          {
            version: 5,
            whitelist: [{ name: 'duckdb_main', type: 'connection', children: [
              { name: 'public', type: 'schema', children: [{ name: 'products', type: 'table' }] }
            ]}],
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
        []
      );

      const { data: contexts } = await FilesAPI.loadFiles([gappedContextId], nonAdminUser);
      const content = contexts[0].content as ContextContent;

      // Should load version 5 (published.all)
      expect(content.versions![0].version).toBe(5);

      // fullSchema computed from version 5's whitelist (only products table)
      const duckdb = content.fullSchema!.find(db => db.databaseName === 'duckdb_main');
      expect(duckdb).toBeDefined();
      expect(duckdb!.schemas[0].tables).toHaveLength(1); // Only products (version 5 whitelist)
      expect(duckdb!.schemas[0].tables[0].table).toBe('products');
    });
  });

  describe('Path-based whitelist inheritance', () => {
    it('should filter child context by childPaths in parent whitelist', async () => {
      // Create parent context at /org/testing with childPaths
      // This inherits from /org/context (which has fullSchema from connections)
      const parentContextId = await mkPublishedContext('context', '/org/testing/context', {
        versions: [{
          version: 1,
          whitelist: [{ name: 'duckdb_main', type: 'connection', children: [
            { name: 'public', type: 'schema', children: [
              { name: 'users', type: 'table', childPaths: ['/org/testing/sales'] },
              { name: 'orders', type: 'table', childPaths: ['/org/testing/marketing'] }
            ]}
          ]}],
          docs: [{ content: 'Parent context' }],
          createdAt: new Date().toISOString(),
          createdBy: 1
        }],
        published: { all: 1 }
      } as ContextContent);

      // Create child context at /org/testing/sales (should see users, not orders)
      const salesContextId = await DocumentDB.create(
        'context',
        '/org/testing/sales/context',
        'context',
        {
          versions: [{
            version: 1,
            whitelist: '*',
            docs: [{ content: 'Sales context' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        []
      );

      // Create child context at /org/testing/marketing (should see orders, not users)
      const marketingContextId = await DocumentDB.create(
        'context',
        '/org/testing/marketing/context',
        'context',
        {
          versions: [{
            version: 1,
            whitelist: '*',
            docs: [{ content: 'Marketing context' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        []
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
      // Create parent context without childPaths (applies to all)
      const parentContextId = await mkPublishedContext('context', '/org/testing2/context', {
        versions: [{
          version: 1,
          whitelist: [{ name: 'duckdb_main', type: 'connection', children: [
            { name: 'public', type: 'schema', children: [
              { name: 'products', type: 'table' }  // No childPaths — applies to all children
            ]}
          ]}],
          docs: [{ content: 'Parent context' }],
          createdAt: new Date().toISOString(),
          createdBy: 1
        }],
        published: { all: 1 }
      } as ContextContent);

      // Create child contexts
      const child1Id = await DocumentDB.create(
        'context',
        '/org/testing2/team1/context',
        'context',
        {
          versions: [{
            version: 1,
            whitelist: '*',
            docs: [{ content: 'Child 1' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        []
      );

      const child2Id = await DocumentDB.create(
        'context',
        '/org/testing2/team2/context',
        'context',
        {
          versions: [{
            version: 1,
            whitelist: '*',
            docs: [{ content: 'Child 2' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        []
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
      // Create parent context with childPaths: ['/org/testing3/sales']
      const parentContextId = await mkPublishedContext('context', '/org/testing3/context', {
        versions: [{
          version: 1,
          whitelist: [{ name: 'duckdb_main', type: 'connection', children: [
            { name: 'public', type: 'schema', children: [
              { name: 'users', type: 'table', childPaths: ['/org/testing3/sales'] }
            ]}
          ]}],
          docs: [{ content: 'Parent context' }],
          createdAt: new Date().toISOString(),
          createdBy: 1
        }],
        published: { all: 1 }
      } as ContextContent);

      // Create nested child at /org/testing3/sales/north/context
      const nestedChildId = await DocumentDB.create(
        'context',
        '/org/testing3/sales/north/context',
        'context',
        {
          versions: [{
            version: 1,
            whitelist: '*',
            docs: [{ content: 'Nested child' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        []
      );

      // Create unrelated child at /org/testing3/marketing/context
      const unrelatedChildId = await DocumentDB.create(
        'context',
        '/org/testing3/marketing/context',
        'context',
        {
          versions: [{
            version: 1,
            whitelist: '*',  // Wants everything parent allows, but parent restricts to sales path
            docs: [{ content: 'Unrelated child' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        []
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
      // Create parent context with schema-level childPaths
      const parentContextId = await mkPublishedContext('context', '/org/testing4/context', {
        versions: [{
          version: 1,
          whitelist: [{ name: 'duckdb_main', type: 'connection', children: [
            // Whitelist entire schema with childPaths restriction
            { name: 'public', type: 'schema', childPaths: ['/org/testing4/engineering'] }
          ]}],
          docs: [{ content: 'Parent with schema-level childPaths' }],
          createdAt: new Date().toISOString(),
          createdBy: 1
        }],
        published: { all: 1 }
      } as ContextContent);

      // Create child at /org/testing4/engineering (should see entire schema)
      const engineeringContextId = await DocumentDB.create(
        'context',
        '/org/testing4/engineering/context',
        'context',
        {
          versions: [{
            version: 1,
            whitelist: '*',
            docs: [{ content: 'Engineering context' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        []
      );

      // Create child at /org/testing4/sales (should NOT see schema)
      const salesContextId2 = await DocumentDB.create(
        'context',
        '/org/testing4/sales/context',
        'context',
        {
          versions: [{
            version: 1,
            whitelist: '*',  // Wants everything parent allows, but parent restricts to engineering
            docs: [{ content: 'Sales context' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        []
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
      // Parent whitelists tables with childPaths
      const parentContextId = await mkPublishedContext('context', '/org/testing5/context', {
        versions: [{
          version: 1,
          whitelist: [{ name: 'duckdb_main', type: 'connection', children: [
            { name: 'public', type: 'schema', children: [
              { name: 'users', type: 'table', childPaths: ['/org/testing5/team_a'] },
              { name: 'orders', type: 'table', childPaths: ['/org/testing5/team_b'] }
            ]}
          ]}],
          docs: [{ content: 'Parent with childPaths' }],
          createdAt: new Date().toISOString(),
          createdBy: 1
        }],
        published: { all: 1 }
      } as ContextContent);

      // Child at /org/testing5/team_a with DIFFERENT whitelist (whitelists orders, not users)
      // But parent only allows users for this path!
      const teamAContextId = await DocumentDB.create(
        'context',
        '/org/testing5/team_a/context',
        'context',
        {
          versions: [{
            version: 1,
            whitelist: [{ name: 'duckdb_main', type: 'connection', children: [
              { name: 'public', type: 'schema', children: [
                // Child WANTS orders, but parent restricts this path to users only
                { name: 'orders', type: 'table' }
              ]}
            ]}],
            docs: [{ content: 'Team A context' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        []
      );

      // Load child context
      const { data: [teamAChild] } = await FilesAPI.loadFiles([teamAContextId], nonAdminUser);
      const teamAContent = teamAChild.content as ContextContent;

      // CRITICAL: fullSchema should be EMPTY because:
      // - Parent only allows 'users' for team_a (childPaths restriction)
      // - Child's whitelist requests 'orders' only
      // - Intersection of parent offering {users} and child whitelist {orders} = empty
      // This proves parent's childPaths restriction CANNOT be bypassed by child's whitelist
      expect(teamAContent.fullSchema).toBeDefined();
      expect(teamAContent.fullSchema).toHaveLength(0); // Child cannot get what parent doesn't allow

      const teamADb = teamAContent.fullSchema!.find(d => d.databaseName === 'duckdb_main');
      expect(teamADb).toBeUndefined(); // No databases accessible

      // orders is blocked (parent restricts to /org/testing5/team_b only)
      // users is blocked too (child doesn't request it)
      // products was never in parent whitelist
    });

    it('E2E: child can only whitelist from parent-allowed fullSchema', async () => {
      // Test the complete flow: parent restricts → child loads → child can only select allowed tables
      // Parent restricts severely
      const parentContextId = await mkPublishedContext('context', '/org/testing6/context', {
        versions: [{
          version: 1,
          whitelist: [{ name: 'duckdb_main', type: 'connection', children: [
            { name: 'public', type: 'schema', children: [
              { name: 'users', type: 'table', childPaths: ['/org/testing6/restricted'] }
              // Only 'users' table, only for /org/testing6/restricted path
            ]}
          ]}],
          docs: [{ content: 'Severely restricted parent' }],
          createdAt: new Date().toISOString(),
          createdBy: 1
        }],
        published: { all: 1 }
      } as ContextContent);

      // Child at /org/testing6/restricted uses '*' to expose everything parent allows
      const restrictedContextId = await DocumentDB.create(
        'context',
        '/org/testing6/restricted/context',
        'context',
        {
          versions: [{
            version: 1,
            whitelist: '*',  // Expose everything parent allows for this path
            docs: [{ content: 'Restricted child' }],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        []
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
      const parentContextId = await mkPublishedContext('context', '/org/testing7/context', {
        versions: [{
          version: 1,
          whitelist: [{ name: 'duckdb_main', type: 'connection', children: [
            { name: 'public', type: 'schema', children: [
              { name: 'users', type: 'table', childPaths: ['/org/testing7/sales', '/org/testing7/support'] },
              { name: 'orders', type: 'table', childPaths: ['/org/testing7/sales'] },
              { name: 'products', type: 'table', childPaths: ['/org/testing7/sales'] }
            ]}
          ]}],
          docs: [{ content: 'Multi-team parent' }],
          createdAt: new Date().toISOString(),
          createdBy: 1
        }],
        published: { all: 1 }
      } as ContextContent);

      // Sales team - expose everything parent allows (users, orders, products)
      const salesContextId = await DocumentDB.create(
        'context',
        '/org/testing7/sales/context',
        'context',
        {
          versions: [{
            version: 1,
            whitelist: '*',
            docs: [],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        []
      );

      // Support team - expose everything parent allows (only users)
      const supportContextId = await DocumentDB.create(
        'context',
        '/org/testing7/support/context',
        'context',
        {
          versions: [{
            version: 1,
            whitelist: '*',
            docs: [],
            createdAt: new Date().toISOString(),
            createdBy: 1
          }],
          published: { all: 1 }
        } as ContextContent,
        []
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

  // ─────────────────────────────────────────────────────────────────────────
  // Subfolder user access scenarios
  //
  // These tests cover a viewer whose home_folder resolves to a subfolder
  // (e.g. home_folder='sales' → /org/sales) rather than the mode root (/org).
  // Four related bugs are exercised:
  //
  //   A. Ancestor context access  — can the user load /org/context?
  //   B. Context discovery        — does getFiles({type:'context'}) return it?
  //   C. Referenced file access   — are dashboard's questions (in parent folder)
  //                                 returned alongside the dashboard?
  //   D. Admin subfolder          — admins bypass path rules regardless of home_folder
  // ─────────────────────────────────────────────────────────────────────────
  describe('Subfolder viewer — ancestor context access (Bug A+B)', () => {
    const subfolderViewer: EffectiveUser = {
      userId: 20,
      name: 'Subfolder Viewer',
      email: 'subfolder-viewer@example.com',
      role: 'viewer',
      mode: 'org',
      home_folder: 'sales'   // resolves to /org/sales
    };

    const subfolderAdmin: EffectiveUser = {
      userId: 21,
      name: 'Subfolder Admin',
      email: 'subfolder-admin@example.com',
      role: 'admin',
      mode: 'org',
      home_folder: 'sales'   // admins get full mode access regardless
    };

    const deeplyNestedViewer: EffectiveUser = {
      userId: 22,
      name: 'Deeply Nested Viewer',
      email: 'nested-viewer@example.com',
      role: 'viewer',
      mode: 'org',
      home_folder: 'sales/team1'  // resolves to /org/sales/team1
    };

    it('can load ancestor context via loadFiles', async () => {
      // /org/context is an ancestor of /org/sales — accessible via isAncestorContext
      const { data: contexts } = await FilesAPI.loadFiles([orgContextId], subfolderViewer);
      expect(contexts).toHaveLength(1);
      const content = contexts[0].content as ContextContent;
      expect(content.versions).toHaveLength(1); // non-admin sees published version only
      expect(content.versions![0].version).toBe(1);
    });

    it('can load context inside their own home folder', async () => {
      // /org/sales/context is inside /org/sales — accessible via homeAccess
      const { data: contexts } = await FilesAPI.loadFiles([salesContextId], subfolderViewer);
      expect(contexts).toHaveLength(1);
    });

    it('cannot load an unrelated sibling context outside their path', async () => {
      const marketingCtxId = await DocumentDB.create(
        'context', '/org/marketing/context', 'context',
        {
          versions: [{ version: 1, whitelist: [], docs: [], createdAt: new Date().toISOString(), createdBy: 1, description: '' }],
          published: { all: 1 }, fullSchema: [], fullDocs: []
        } as ContextContent,
        []
      );
      // loadFiles filters inaccessible files silently — expect empty result
      const { data } = await FilesAPI.loadFiles([marketingCtxId], subfolderViewer);
      expect(data).toHaveLength(0);
    });

    it('getFiles without path filter returns both ancestor and home-folder contexts (Bug B)', async () => {
      // This is exactly what ensureContextsLoaded() calls — no paths, type=context
      const result = await FilesAPI.getFiles({ type: 'context', depth: -1 }, subfolderViewer);
      const paths = result.data.map(f => f.path);
      expect(paths).toContain('/org/context');       // ancestor — via isAncestorContext
      expect(paths).toContain('/org/sales/context'); // home folder — via homeAccess
    });

    it('getFiles WITH path filter does NOT return ancestor context (justifies omitting path in ensureContextsLoaded)', async () => {
      const result = await FilesAPI.getFiles({ paths: ['/org/sales'], type: 'context', depth: -1 }, subfolderViewer);
      const paths = result.data.map(f => f.path);
      expect(paths).not.toContain('/org/context');   // ancestor outside path filter
      expect(paths).toContain('/org/sales/context'); // inside /org/sales — returned
    });

    it('admin with subfolder home_folder sees all versions (full mode access)', async () => {
      const { data: contexts } = await FilesAPI.loadFiles([orgContextId], subfolderAdmin);
      expect(contexts).toHaveLength(1);
      const content = contexts[0].content as ContextContent;
      expect(content.versions).toHaveLength(2); // admin sees all versions
    });

    it('deeply nested viewer can access both grandparent and parent ancestor contexts', async () => {
      // home_folder='sales/team1' → /org/sales/team1
      // /org/context:       contextDir=/org,       /org/sales/team1 startsWith /org/ ✓
      // /org/sales/context: contextDir=/org/sales, /org/sales/team1 startsWith /org/sales/ ✓
      const result = await FilesAPI.getFiles({ type: 'context', depth: -1 }, deeplyNestedViewer);
      const paths = result.data.map(f => f.path);
      expect(paths).toContain('/org/context');
      expect(paths).toContain('/org/sales/context');
    });

    it('deeply nested viewer can fully load ancestor context content', async () => {
      const { data: contexts } = await FilesAPI.loadFiles([orgContextId], deeplyNestedViewer);
      expect(contexts).toHaveLength(1);
      const content = contexts[0].content as ContextContent;
      expect(content.versions).toHaveLength(1);
      expect(content.fullSchema!.find(db => db.databaseName === 'duckdb_main')).toBeDefined();
    });
  });

  describe('Subfolder viewer — dashboard references questions in parent folder (Bug C)', () => {
    const subfolderViewer: EffectiveUser = {
      userId: 30,
      name: 'Dashboard Viewer',
      email: 'dashboard-viewer@example.com',
      role: 'viewer',
      mode: 'org',
      home_folder: 'sales'   // resolves to /org/sales
    };

    it('dashboard in home folder returns referenced questions even when questions are in parent folder', async () => {
      // Question lives at /org/my-question — OUTSIDE /org/sales (subfolder viewer's home)
      const questionContent: QuestionContent = {
        query: 'SELECT 1',
        description: '',
        vizSettings: { type: 'table' },
        parameters: [],
        connection_name: 'duckdb_main'
      };
      const questionId = await DocumentDB.create(
        'question', '/org/my-question', 'question',
        questionContent, []
      );

      // Dashboard lives at /org/sales/my-dashboard — INSIDE home folder
      // References the question in the parent folder
      const dashboardContent: DocumentContent = {
        description: '',
        assets: [{ type: 'question', id: questionId }],
        layout: { columns: 12, items: [] }
      };
      const dashboardId = await DocumentDB.create(
        'dashboard', '/org/sales/my-dashboard', 'dashboard',
        dashboardContent, [questionId]
      );

      const { data: files, metadata } = await FilesAPI.loadFiles([dashboardId], subfolderViewer);

      // Dashboard itself is accessible (in home folder)
      expect(files).toHaveLength(1);
      expect(files[0].path).toBe('/org/sales/my-dashboard');

      // Referenced question MUST be in the references list even though it's in /org (parent)
      // If this fails, the dashboard renders empty — Bug C
      expect(metadata.references).toHaveLength(1);
      expect(metadata.references[0].path).toBe('/org/my-question');
    });

    it('dashboard in home folder returns referenced questions in sibling folders', async () => {
      // Question in /org/shared/report-question — outside home, not ancestor
      const questionId = await DocumentDB.create(
        'question', '/org/shared/report-question', 'question',
        { query: 'SELECT 2', description: '', vizSettings: { type: 'table' }, parameters: [], connection_name: 'duckdb_main' } as QuestionContent,
        []
      );

      const dashboardId = await DocumentDB.create(
        'dashboard', '/org/sales/team-dashboard', 'dashboard',
        { description: '', assets: [{ type: 'question', id: questionId }], layout: { columns: 12, items: [] } } as DocumentContent,
        [questionId]
      );

      const { data: files, metadata } = await FilesAPI.loadFiles([dashboardId], subfolderViewer);
      expect(files).toHaveLength(1);
      // Reference must be returned — access via reference chain, not direct path check
      expect(metadata.references).toHaveLength(1);
      expect(metadata.references[0].path).toBe('/org/shared/report-question');
    });

    it('user cannot directly load a question outside their accessible paths', async () => {
      // Direct load (not via reference) of a parent-folder question is still denied
      const questionId = await DocumentDB.create(
        'question', '/org/top-level-question', 'question',
        { query: 'SELECT 3', description: '', vizSettings: { type: 'table' }, parameters: [], connection_name: 'duckdb_main' } as QuestionContent,
        []
      );

      const { data } = await FilesAPI.loadFiles([questionId], subfolderViewer);
      // Direct access denied — not in home folder, not a reference
      expect(data).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Whitelist filtering — comprehensive cases
  //
  // These tests verify every combination of Whitelist values at every level
  // of the connection → schema → table hierarchy, for both root and child
  // contexts.  They are the primary guard against regressions like "empty
  // whitelist falls back to parent schema" (the bug that prompted this suite).
  //
  // Parent setup (from outer beforeEach):
  //   /org/context  whitelist: duckdb_main/public/{users,orders,products}
  //                 bigquery_analytics NOT exposed
  // ─────────────────────────────────────────────────────────────────────────
  describe('Whitelist filtering — comprehensive cases', () => {
    // ── Helpers ─────────────────────────────────────────────────────────────

    /**
     * Delete and recreate /org/context with a custom whitelist.
     * Returns the new context ID.
     */
    async function replaceRootContext(whitelist: import('@/lib/types').Whitelist): Promise<number> {
      await getModules().db.exec("DELETE FROM files WHERE path = '/org/context'", []);
      const content: ContextContent = {
        versions: [{
          version: 1,
          whitelist,
          docs: [],
          createdAt: new Date().toISOString(),
          createdBy: 1,
          description: 'Root context for whitelist test',
        }],
        published: { all: 1 },
        fullSchema: [],
        fullDocs: [],
      };
      const id = await DocumentDB.create('context', '/org/context', 'context', content, []);
      await DocumentDB.update(id, 'context', '/org/context', content, [], 'init-root-context');
      return id;
    }

    /** Unique suffix counter for child context paths — avoids path collisions within a test. */
    let childSuffix = 0;

    /**
     * Create a child context under /org/ with a custom whitelist.
     * The parent (/org/context) is whatever was set by the outer beforeEach or replaceRootContext.
     */
    async function createChildContext(whitelist: import('@/lib/types').Whitelist): Promise<number> {
      const path = `/org/wl_child_${++childSuffix}/context`;
      return DocumentDB.create('context', path, 'context', {
        versions: [{
          version: 1,
          whitelist,
          docs: [],
          createdAt: new Date().toISOString(),
          createdBy: 1,
        }],
        published: { all: 1 },
        fullSchema: [],
        fullDocs: [],
      } as ContextContent, []);
    }

    // ── Root context — whitelist filters connections directly ────────────────

    describe('Root context whitelist', () => {
      it("whitelist: '*' exposes all connections and all their schemas/tables", async () => {
        const rootId = await replaceRootContext('*');
        const { data: [ctx] } = await FilesAPI.loadFiles([rootId], nonAdminUser);
        const schema = (ctx.content as ContextContent).fullSchema!;

        const duckdb = schema.find(db => db.databaseName === 'duckdb_main');
        expect(duckdb).toBeDefined();
        expect(duckdb!.schemas[0].tables.map(t => t.table).sort()).toEqual(['orders', 'products', 'users']);

        const bq = schema.find(db => db.databaseName === 'bigquery_analytics');
        expect(bq).toBeDefined();
        expect(bq!.schemas[0].tables[0].table).toBe('events');
      });

      it('whitelist: [] exposes nothing', async () => {
        const rootId = await replaceRootContext([]);
        const { data: [ctx] } = await FilesAPI.loadFiles([rootId], nonAdminUser);
        expect((ctx.content as ContextContent).fullSchema).toEqual([]);
      });

      it('connection absent from whitelist is excluded', async () => {
        const rootId = await replaceRootContext([
          { name: 'duckdb_main', type: 'connection', children: [{ name: 'public', type: 'schema' }] },
          // bigquery_analytics intentionally absent
        ]);
        const { data: [ctx] } = await FilesAPI.loadFiles([rootId], nonAdminUser);
        const schema = (ctx.content as ContextContent).fullSchema!;
        expect(schema.find(db => db.databaseName === 'duckdb_main')).toBeDefined();
        expect(schema.find(db => db.databaseName === 'bigquery_analytics')).toBeUndefined();
      });

      it('connection with children:undefined exposes all its schemas', async () => {
        const rootId = await replaceRootContext([
          { name: 'duckdb_main', type: 'connection' }, // children omitted = expose all
        ]);
        const { data: [ctx] } = await FilesAPI.loadFiles([rootId], nonAdminUser);
        const duckdb = (ctx.content as ContextContent).fullSchema!.find(db => db.databaseName === 'duckdb_main');
        expect(duckdb).toBeDefined();
        expect(duckdb!.schemas[0].tables).toHaveLength(3);
      });

      it('connection with children:[] exposes nothing', async () => {
        const rootId = await replaceRootContext([
          { name: 'duckdb_main', type: 'connection', children: [] },
        ]);
        const { data: [ctx] } = await FilesAPI.loadFiles([rootId], nonAdminUser);
        expect((ctx.content as ContextContent).fullSchema).toEqual([]);
      });

      it('schema with children:undefined exposes all tables in that schema', async () => {
        const rootId = await replaceRootContext([
          { name: 'duckdb_main', type: 'connection', children: [
            { name: 'public', type: 'schema' }, // children omitted = expose all tables
          ]},
        ]);
        const { data: [ctx] } = await FilesAPI.loadFiles([rootId], nonAdminUser);
        const duckdb = (ctx.content as ContextContent).fullSchema!.find(db => db.databaseName === 'duckdb_main');
        expect(duckdb!.schemas[0].tables.map(t => t.table).sort()).toEqual(['orders', 'products', 'users']);
      });

      it('schema with children:[] exposes nothing', async () => {
        const rootId = await replaceRootContext([
          { name: 'duckdb_main', type: 'connection', children: [
            { name: 'public', type: 'schema', children: [] },
          ]},
        ]);
        const { data: [ctx] } = await FilesAPI.loadFiles([rootId], nonAdminUser);
        expect((ctx.content as ContextContent).fullSchema).toEqual([]);
      });

      it('schema with specific tables exposes only those tables', async () => {
        const rootId = await replaceRootContext([
          { name: 'duckdb_main', type: 'connection', children: [
            { name: 'public', type: 'schema', children: [
              { name: 'users', type: 'table' },
              { name: 'orders', type: 'table' },
              // products NOT listed
            ]},
          ]},
        ]);
        const { data: [ctx] } = await FilesAPI.loadFiles([rootId], nonAdminUser);
        const tables = (ctx.content as ContextContent).fullSchema!
          .find(db => db.databaseName === 'duckdb_main')!
          .schemas[0].tables.map(t => t.table).sort();
        expect(tables).toEqual(['orders', 'users']);
        expect(tables).not.toContain('products');
      });

      it('single table whitelist exposes only that table', async () => {
        const rootId = await replaceRootContext([
          { name: 'duckdb_main', type: 'connection', children: [
            { name: 'public', type: 'schema', children: [
              { name: 'users', type: 'table' },
            ]},
          ]},
        ]);
        const { data: [ctx] } = await FilesAPI.loadFiles([rootId], nonAdminUser);
        const duckdb = (ctx.content as ContextContent).fullSchema!.find(db => db.databaseName === 'duckdb_main');
        expect(duckdb!.schemas[0].tables).toHaveLength(1);
        expect(duckdb!.schemas[0].tables[0].table).toBe('users');
      });

      it('schema absent from connection schema is excluded', async () => {
        const rootId = await replaceRootContext([
          { name: 'duckdb_main', type: 'connection', children: [
            { name: 'nonexistent_schema', type: 'schema' },
          ]},
        ]);
        const { data: [ctx] } = await FilesAPI.loadFiles([rootId], nonAdminUser);
        expect((ctx.content as ContextContent).fullSchema).toEqual([]);
      });
    });

    // ── Child context — own whitelist applied to parent offering ────────────
    //
    // The outer beforeEach sets up /org/context with:
    //   whitelist: duckdb_main/public/{users, orders, products}  (bigquery NOT included)

    describe('Child context whitelist', () => {
      it("whitelist: '*' inherits the full parent offering unchanged", async () => {
        const id = await createChildContext('*');
        const { data: [ctx] } = await FilesAPI.loadFiles([id], nonAdminUser);
        const duckdb = (ctx.content as ContextContent).fullSchema!.find(db => db.databaseName === 'duckdb_main');
        expect(duckdb).toBeDefined();
        expect(duckdb!.schemas[0].tables.map(t => t.table).sort()).toEqual(['orders', 'products', 'users']);
        // bigquery not in parent → absent even though child has '*'
        expect((ctx.content as ContextContent).fullSchema!.find(db => db.databaseName === 'bigquery_analytics')).toBeUndefined();
      });

      it('CRITICAL: whitelist: [] exposes nothing — must NOT fall back to parent', async () => {
        // This is the exact user-reported bug: a folder context with an empty whitelist
        // was incorrectly showing the parent's schema in the right sidebar.
        const id = await createChildContext([]);
        const { data: [ctx] } = await FilesAPI.loadFiles([id], nonAdminUser);
        expect((ctx.content as ContextContent).fullSchema).toEqual([]);
      });

      it('CRITICAL: connection with children:[] exposes nothing — the editor saves this when whitelist is empty for a connection', async () => {
        // This is exactly what ContextContainerV2 saves when the user has
        //   databases: [{ databaseName: 'duckdb_main', whitelist: [] }]
        // The resulting WhitelistNode has children:[], which must produce fullSchema:[].
        const id = await createChildContext([
          { name: 'duckdb_main', type: 'connection', children: [] },
        ]);
        const { data: [ctx] } = await FilesAPI.loadFiles([id], nonAdminUser);
        expect((ctx.content as ContextContent).fullSchema).toEqual([]);
      });

      it('child cannot access a connection not offered by parent', async () => {
        // bigquery_analytics is NOT in the parent whitelist (beforeEach /org/context)
        const id = await createChildContext([
          { name: 'bigquery_analytics', type: 'connection', children: [
            { name: 'analytics', type: 'schema' },
          ]},
        ]);
        const { data: [ctx] } = await FilesAPI.loadFiles([id], nonAdminUser);
        expect((ctx.content as ContextContent).fullSchema).toEqual([]);
      });

      it('child restricts to a subset of the parent offering', async () => {
        // Parent: duckdb_main/public/{users, orders, products}
        // Child:  duckdb_main/public/{users}
        const id = await createChildContext([
          { name: 'duckdb_main', type: 'connection', children: [
            { name: 'public', type: 'schema', children: [
              { name: 'users', type: 'table' },
            ]},
          ]},
        ]);
        const { data: [ctx] } = await FilesAPI.loadFiles([id], nonAdminUser);
        const duckdb = (ctx.content as ContextContent).fullSchema!.find(db => db.databaseName === 'duckdb_main');
        expect(duckdb).toBeDefined();
        expect(duckdb!.schemas[0].tables).toHaveLength(1);
        expect(duckdb!.schemas[0].tables[0].table).toBe('users');
      });

      it('child requesting a table not in parent offering gets nothing', async () => {
        // 'events' does not exist in duckdb_main/public (only in bigquery, not offered)
        const id = await createChildContext([
          { name: 'duckdb_main', type: 'connection', children: [
            { name: 'public', type: 'schema', children: [
              { name: 'events', type: 'table' },
            ]},
          ]},
        ]);
        const { data: [ctx] } = await FilesAPI.loadFiles([id], nonAdminUser);
        expect((ctx.content as ContextContent).fullSchema).toEqual([]);
      });

      it('child schema with children:[] exposes nothing from that schema', async () => {
        const id = await createChildContext([
          { name: 'duckdb_main', type: 'connection', children: [
            { name: 'public', type: 'schema', children: [] },
          ]},
        ]);
        const { data: [ctx] } = await FilesAPI.loadFiles([id], nonAdminUser);
        expect((ctx.content as ContextContent).fullSchema).toEqual([]);
      });

      it('child schema with children:undefined exposes all tables offered by parent', async () => {
        const id = await createChildContext([
          { name: 'duckdb_main', type: 'connection', children: [
            { name: 'public', type: 'schema' }, // expose all tables parent allows
          ]},
        ]);
        const { data: [ctx] } = await FilesAPI.loadFiles([id], nonAdminUser);
        const duckdb = (ctx.content as ContextContent).fullSchema!.find(db => db.databaseName === 'duckdb_main');
        expect(duckdb!.schemas[0].tables).toHaveLength(3);
      });

      it('child with connection children:undefined exposes all schemas/tables offered by parent', async () => {
        const id = await createChildContext([
          { name: 'duckdb_main', type: 'connection' }, // expose all parent allows
        ]);
        const { data: [ctx] } = await FilesAPI.loadFiles([id], nonAdminUser);
        const duckdb = (ctx.content as ContextContent).fullSchema!.find(db => db.databaseName === 'duckdb_main');
        expect(duckdb).toBeDefined();
        expect(duckdb!.schemas[0].tables).toHaveLength(3);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Path-based whitelist hierarchy
  //
  // These tests verify the full ancestor-chain:  given a context at some
  // path, what schemas does it actually expose after the entire chain of
  // parent restrictions has been applied?
  //
  // They differ from the "comprehensive cases" suite above, which tests
  // single-level whitelist semantics.  Here we wire together two or three
  // levels and assert on the final `fullSchema` at the leaf.
  // ─────────────────────────────────────────────────────────────────────────
  describe('Path-based whitelist hierarchy', () => {
    type Whitelist = import('@/lib/types').Whitelist;

    // ── Shared helpers ───────────────────────────────────────────────────

    async function replaceRootCtx(whitelist: Whitelist): Promise<number> {
      await getModules().db.exec("DELETE FROM files WHERE path = '/org/context'", []);
      const content: ContextContent = {
        versions: [{ version: 1, whitelist, docs: [], createdAt: new Date().toISOString(), createdBy: 1 }],
        published: { all: 1 },
        fullSchema: [],
        fullDocs: [],
      };
      const id = await DocumentDB.create('context', '/org/context', 'context', content, []);
      await DocumentDB.update(id, 'context', '/org/context', content, [], 'init-root-ctx');
      return id;
    }

    async function mkContext(path: string, whitelist: Whitelist): Promise<number> {
      const content: ContextContent = {
        versions: [{ version: 1, whitelist, docs: [], createdAt: new Date().toISOString(), createdBy: 1 }],
        published: { all: 1 },
        fullSchema: [],
        fullDocs: [],
      };
      const id = await DocumentDB.create('context', path, 'context', content, []);
      await DocumentDB.update(id, 'context', path, content, [], `init-${id}`);
      return id;
    }

    function tables(content: ContextContent): string[] {
      return (content.fullSchema ?? [])
        .flatMap(db => db.schemas)
        .flatMap(s => s.tables)
        .map(t => t.table)
        .sort();
    }

    // ── Tests ────────────────────────────────────────────────────────────

    it('three-level hierarchy: each level narrows the whitelist', async () => {
      // /org/context:           all three tables
      // /org/dept/context:      users + orders only
      // /org/dept/team/context: users only
      await replaceRootCtx([
        { name: 'duckdb_main', type: 'connection', children: [
          { name: 'public', type: 'schema' }, // expose all
        ]},
      ]);
      await mkContext('/org/dept/context', [
        { name: 'duckdb_main', type: 'connection', children: [
          { name: 'public', type: 'schema', children: [
            { name: 'users', type: 'table' },
            { name: 'orders', type: 'table' },
          ]},
        ]},
      ]);
      const leafId = await mkContext('/org/dept/team/context', [
        { name: 'duckdb_main', type: 'connection', children: [
          { name: 'public', type: 'schema', children: [
            { name: 'users', type: 'table' },
          ]},
        ]},
      ]);

      const { data: [ctx] } = await FilesAPI.loadFiles([leafId], nonAdminUser);
      expect(tables(ctx.content as ContextContent)).toEqual(['users']);
    });

    it('grandchild with whitelist:* is bounded by the nearest parent, not the root', async () => {
      // /org/context:       users + orders + products
      // /org/mid/context:   users + orders  (narrows)
      // /org/mid/leaf/context: *  (wants everything — but nearest parent only has users+orders)
      await replaceRootCtx([
        { name: 'duckdb_main', type: 'connection', children: [{ name: 'public', type: 'schema' }] },
      ]);
      await mkContext('/org/mid/context', [
        { name: 'duckdb_main', type: 'connection', children: [
          { name: 'public', type: 'schema', children: [
            { name: 'users', type: 'table' },
            { name: 'orders', type: 'table' },
          ]},
        ]},
      ]);
      const leafId = await mkContext('/org/mid/leaf/context', '*');

      const { data: [ctx] } = await FilesAPI.loadFiles([leafId], nonAdminUser);
      const t = tables(ctx.content as ContextContent);
      // Bounded by nearest parent (/org/mid/context), NOT the root
      expect(t).toEqual(['orders', 'users']);
      expect(t).not.toContain('products');
    });

    it('child cannot exceed ancestor-chain ceiling even with explicit whitelist', async () => {
      // /org/context:       users + orders  (products NOT available)
      // /org/dept/context:  wants users + orders + products → products silently excluded
      await replaceRootCtx([
        { name: 'duckdb_main', type: 'connection', children: [
          { name: 'public', type: 'schema', children: [
            { name: 'users', type: 'table' },
            { name: 'orders', type: 'table' },
          ]},
        ]},
      ]);
      const childId = await mkContext('/org/dept/context', [
        { name: 'duckdb_main', type: 'connection', children: [
          { name: 'public', type: 'schema', children: [
            { name: 'users', type: 'table' },
            { name: 'orders', type: 'table' },
            { name: 'products', type: 'table' }, // not in root → excluded
          ]},
        ]},
      ]);

      const { data: [ctx] } = await FilesAPI.loadFiles([childId], nonAdminUser);
      const t = tables(ctx.content as ContextContent);
      expect(t).toEqual(['orders', 'users']);
      expect(t).not.toContain('products');
    });

    it('two siblings under the same parent get different schemas based on their own whitelist', async () => {
      // /org/context (from beforeEach): duckdb_main/public/{users, orders, products}
      // /org/alpha/context: users + orders
      // /org/beta/context:  products only
      const alphaId = await mkContext('/org/alpha/context', [
        { name: 'duckdb_main', type: 'connection', children: [
          { name: 'public', type: 'schema', children: [
            { name: 'users', type: 'table' },
            { name: 'orders', type: 'table' },
          ]},
        ]},
      ]);
      const betaId = await mkContext('/org/beta/context', [
        { name: 'duckdb_main', type: 'connection', children: [
          { name: 'public', type: 'schema', children: [
            { name: 'products', type: 'table' },
          ]},
        ]},
      ]);

      const { data: [alpha, beta] } = await FilesAPI.loadFiles([alphaId, betaId], nonAdminUser);
      expect(tables(alpha.content as ContextContent)).toEqual(['orders', 'users']);
      expect(tables(beta.content as ContextContent)).toEqual(['products']);
    });

    it('whitelist:* at each level propagates the full parent offering unchanged', async () => {
      // /org/context (beforeEach): duckdb_main/public/{users, orders, products}
      // /org/pass/context:         *  → sees {users, orders, products}
      // /org/pass/through/context: *  → also sees {users, orders, products}
      const midId = await mkContext('/org/pass/context', '*');
      const leafId = await mkContext('/org/pass/through/context', '*');

      const { data: [mid, leaf] } = await FilesAPI.loadFiles([midId, leafId], nonAdminUser);
      expect(tables(mid.content as ContextContent)).toEqual(['orders', 'products', 'users']);
      expect(tables(leaf.content as ContextContent)).toEqual(['orders', 'products', 'users']);
    });

    it('missing intermediate context — skips to nearest existing ancestor', async () => {
      // /org/context (beforeEach): users + orders + products
      // /org/gap/context:          does NOT exist
      // /org/gap/leaf/context:     *  → nearest ancestor is /org/context
      //                                → should see all three tables
      // (no mkContext('/org/gap/context') call)
      const leafId = await mkContext('/org/gap/leaf/context', '*');

      const { data: [ctx] } = await FilesAPI.loadFiles([leafId], nonAdminUser);
      expect(tables(ctx.content as ContextContent)).toEqual(['orders', 'products', 'users']);
    });

    it('context at path exposes empty schema when its whitelist is empty regardless of parent', async () => {
      // /org/context (beforeEach): users + orders + products
      // /org/blocked/context:      []  → fullSchema must be []
      const id = await mkContext('/org/blocked/context', []);

      const { data: [ctx] } = await FilesAPI.loadFiles([id], nonAdminUser);
      expect((ctx.content as ContextContent).fullSchema).toEqual([]);
    });

    it('deep path uses nearest ancestor, not the root, for inheritance', async () => {
      // Verify findNearestAncestorContext picks /org/deep/mid/context over /org/context
      // /org/context:           users + orders + products
      // /org/deep/context:      users only  (strips orders and products)
      // /org/deep/mid/context:  *
      // /org/deep/mid/leaf/context: *
      // Both mid and leaf should be bounded by /org/deep/context (users only)
      await replaceRootCtx([
        { name: 'duckdb_main', type: 'connection', children: [{ name: 'public', type: 'schema' }] },
      ]);
      await mkContext('/org/deep/context', [
        { name: 'duckdb_main', type: 'connection', children: [
          { name: 'public', type: 'schema', children: [{ name: 'users', type: 'table' }] },
        ]},
      ]);
      const midId  = await mkContext('/org/deep/mid/context', '*');
      const leafId = await mkContext('/org/deep/mid/leaf/context', '*');

      const { data: [mid, leaf] } = await FilesAPI.loadFiles([midId, leafId], nonAdminUser);
      // Both bounded by /org/deep/context → only users
      expect(tables(mid.content as ContextContent)).toEqual(['users']);
      expect(tables(leaf.content as ContextContent)).toEqual(['users']);
    });

    it('connection exposed at root but blocked at intermediate level is gone for all descendants', async () => {
      // /org/context:           duckdb_main + bigquery_analytics (both)
      // /org/mid/context:       duckdb_main only (drops bigquery)
      // /org/mid/leaf/context:  *  → should only see duckdb_main
      await replaceRootCtx('*'); // exposes both connections

      await mkContext('/org/mid/context', [
        { name: 'duckdb_main', type: 'connection', children: [{ name: 'public', type: 'schema' }] },
        // bigquery intentionally dropped
      ]);
      const leafId = await mkContext('/org/mid/leaf/context', '*');

      const { data: [ctx] } = await FilesAPI.loadFiles([leafId], nonAdminUser);
      const schema = (ctx.content as ContextContent).fullSchema!;
      expect(schema.find(db => db.databaseName === 'duckdb_main')).toBeDefined();
      expect(schema.find(db => db.databaseName === 'bigquery_analytics')).toBeUndefined();
    });
  });
});
