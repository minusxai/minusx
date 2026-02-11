/**
 * E2E Tests for Table/Column Suggestion APIs
 * Tests getTableSuggestions and getColumnSuggestions at the completions API level
 */

// Database-specific mock (test name must match)
jest.mock('@/lib/database/db-config', () => {
  const path = require('path');
  return {
    DB_PATH: path.join(process.cwd(), 'data', 'test_completions_suggestions.db'),
    DB_DIR: path.join(process.cwd(), 'data'),
    getDbType: () => 'sqlite' as const
  };
});

// Mock schema introspection to return test schema
jest.mock('@/lib/backend/python-backend', () => ({
  getSchemaFromPython: jest.fn().mockResolvedValue({
    schemas: [
      {
        schema: 'main',
        tables: [
          {
            table: 'users',
            columns: [
              { name: 'id', type: 'INTEGER' },
              { name: 'name', type: 'VARCHAR' },
              { name: 'email', type: 'VARCHAR' },
              { name: 'created_at', type: 'TIMESTAMP' }
            ]
          },
          {
            table: 'orders',
            columns: [
              { name: 'id', type: 'INTEGER' },
              { name: 'user_id', type: 'INTEGER' },
              { name: 'amount', type: 'DECIMAL' },
              { name: 'status', type: 'VARCHAR' }
            ]
          }
        ]
      }
    ]
  })
}));

import { setupTestDb } from '@/test/harness/test-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { CompletionsAPI } from '../completions.server';
import { EffectiveUser } from '@/lib/auth/auth-helpers';

describe('Completions Suggestions - E2E Tests', () => {
  setupTestDb(getTestDbPath('completions_suggestions'), { withTestConnection: true });

  // Mock user for testing
  const mockUser: EffectiveUser = {
    userId: 1,
    name: 'Test User',
    email: 'test@example.com',
    role: 'admin',
    companyId: 1,
    companyName: 'test_company',
    home_folder: '/org',
    mode: 'org',
  };

  describe('getTableSuggestions', () => {
    it('should return list of tables from connection schema', async () => {
      const result = await CompletionsAPI.getTableSuggestions(
        { databaseName: 'default_db' },
        mockUser
      );

      expect(result.success).toBe(true);
      expect(result.tables).toBeDefined();
      expect(Array.isArray(result.tables)).toBe(true);

      if (result.tables && result.tables.length > 0) {
        // Verify table structure
        const table = result.tables[0];
        expect(table).toHaveProperty('name');
        expect(table).toHaveProperty('displayName');
        expect(typeof table.name).toBe('string');
        expect(typeof table.displayName).toBe('string');
      }
    });

    it('should return sorted tables', async () => {
      const result = await CompletionsAPI.getTableSuggestions(
        { databaseName: 'default_db' },
        mockUser
      );

      expect(result.success).toBe(true);

      if (result.tables && result.tables.length > 1) {
        // Verify alphabetical sorting
        for (let i = 0; i < result.tables.length - 1; i++) {
          expect(
            result.tables[i].displayName.localeCompare(result.tables[i + 1].displayName)
          ).toBeLessThanOrEqual(0);
        }
      }
    });

    it('should handle schema-qualified tables', async () => {
      const result = await CompletionsAPI.getTableSuggestions(
        { databaseName: 'default_db' },
        mockUser
      );

      expect(result.success).toBe(true);

      if (result.tables) {
        // Check if any tables have schema qualifier
        const schemaQualified = result.tables.find(t => t.schema);

        if (schemaQualified) {
          // Verify displayName includes schema
          expect(schemaQualified.displayName).toContain(schemaQualified.schema);
          expect(schemaQualified.displayName).toBe(
            `${schemaQualified.schema}.${schemaQualified.name}`
          );
        }
      }
    });

    it('should return error for non-existent database', async () => {
      const result = await CompletionsAPI.getTableSuggestions(
        { databaseName: 'non_existent_db' },
        mockUser
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('not found');
    });

    it('should accept optional currentIR parameter', async () => {
      // This parameter is for future intelligence - should not break with it present
      const result = await CompletionsAPI.getTableSuggestions(
        {
          databaseName: 'default_db',
          currentIR: {
            version: 1,
            select: [{ type: 'column', column: '*' }],
            from: { table: 'users' }
          }
        },
        mockUser
      );

      expect(result.success).toBe(true);
      expect(result.tables).toBeDefined();
    });
  });

  describe('getColumnSuggestions', () => {
    it('should return list of columns for specified table', async () => {
      // First get tables to find a valid table name
      const tablesResult = await CompletionsAPI.getTableSuggestions(
        { databaseName: 'default_db' },
        mockUser
      );

      expect(tablesResult.success).toBe(true);
      expect(tablesResult.tables).toBeDefined();
      expect(tablesResult.tables!.length).toBeGreaterThan(0);

      const testTable = tablesResult.tables![0];

      // Now get columns for that table
      const result = await CompletionsAPI.getColumnSuggestions(
        {
          databaseName: 'default_db',
          table: testTable.name,
          schema: testTable.schema
        },
        mockUser
      );

      expect(result.success).toBe(true);
      expect(result.columns).toBeDefined();
      expect(Array.isArray(result.columns)).toBe(true);

      if (result.columns && result.columns.length > 0) {
        // Verify column structure
        const column = result.columns[0];
        expect(column).toHaveProperty('name');
        expect(column).toHaveProperty('displayName');
        expect(typeof column.name).toBe('string');
        expect(typeof column.displayName).toBe('string');

        // Type is optional but should be string if present
        if (column.type) {
          expect(typeof column.type).toBe('string');
        }
      }
    });

    it('should return sorted columns', async () => {
      // Get a table first
      const tablesResult = await CompletionsAPI.getTableSuggestions(
        { databaseName: 'default_db' },
        mockUser
      );

      const testTable = tablesResult.tables![0];

      const result = await CompletionsAPI.getColumnSuggestions(
        {
          databaseName: 'default_db',
          table: testTable.name,
          schema: testTable.schema
        },
        mockUser
      );

      expect(result.success).toBe(true);

      if (result.columns && result.columns.length > 1) {
        // Verify alphabetical sorting
        for (let i = 0; i < result.columns.length - 1; i++) {
          expect(
            result.columns[i].name.localeCompare(result.columns[i + 1].name)
          ).toBeLessThanOrEqual(0);
        }
      }
    });

    it('should return error for non-existent database', async () => {
      const result = await CompletionsAPI.getColumnSuggestions(
        {
          databaseName: 'non_existent_db',
          table: 'users'
        },
        mockUser
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('not found');
    });

    it('should return error for non-existent table', async () => {
      const result = await CompletionsAPI.getColumnSuggestions(
        {
          databaseName: 'default_db',
          table: 'non_existent_table_xyz'
        },
        mockUser
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('not found');
    });

    it('should handle schema-qualified table lookup', async () => {
      // Find a table with schema qualifier
      const tablesResult = await CompletionsAPI.getTableSuggestions(
        { databaseName: 'default_db' },
        mockUser
      );

      const schemaTable = tablesResult.tables?.find(t => t.schema);

      if (schemaTable) {
        const result = await CompletionsAPI.getColumnSuggestions(
          {
            databaseName: 'default_db',
            table: schemaTable.name,
            schema: schemaTable.schema
          },
          mockUser
        );

        expect(result.success).toBe(true);
        expect(result.columns).toBeDefined();
      }
    });

    it('should accept optional currentIR parameter', async () => {
      // Get a valid table first
      const tablesResult = await CompletionsAPI.getTableSuggestions(
        { databaseName: 'default_db' },
        mockUser
      );

      const testTable = tablesResult.tables![0];

      // This parameter is for future intelligence - should not break with it present
      const result = await CompletionsAPI.getColumnSuggestions(
        {
          databaseName: 'default_db',
          table: testTable.name,
          schema: testTable.schema,
          currentIR: {
            version: 1,
            select: [{ type: 'column', column: '*' }],
            from: { table: testTable.name }
          }
        },
        mockUser
      );

      expect(result.success).toBe(true);
      expect(result.columns).toBeDefined();
    });
  });

  describe('Integration: Tables → Columns workflow', () => {
    it('should support full workflow: get tables, pick one, get columns', async () => {
      // Step 1: Get all tables
      const tablesResult = await CompletionsAPI.getTableSuggestions(
        { databaseName: 'default_db' },
        mockUser
      );

      expect(tablesResult.success).toBe(true);
      expect(tablesResult.tables).toBeDefined();
      expect(tablesResult.tables!.length).toBeGreaterThan(0);

      // Step 2: Pick first table
      const selectedTable = tablesResult.tables![0];
      expect(selectedTable.name).toBeDefined();

      // Step 3: Get columns for selected table
      const columnsResult = await CompletionsAPI.getColumnSuggestions(
        {
          databaseName: 'default_db',
          table: selectedTable.name,
          schema: selectedTable.schema
        },
        mockUser
      );

      expect(columnsResult.success).toBe(true);
      expect(columnsResult.columns).toBeDefined();

      // Should have at least one column
      if (columnsResult.columns) {
        expect(columnsResult.columns.length).toBeGreaterThan(0);
      }
    });

    it('should handle multiple table-to-column lookups', async () => {
      // Get tables
      const tablesResult = await CompletionsAPI.getTableSuggestions(
        { databaseName: 'default_db' },
        mockUser
      );

      expect(tablesResult.success).toBe(true);

      // Get columns for first 3 tables (or all if less than 3)
      const tablesToTest = tablesResult.tables!.slice(0, 3);

      for (const table of tablesToTest) {
        const columnsResult = await CompletionsAPI.getColumnSuggestions(
          {
            databaseName: 'default_db',
            table: table.name,
            schema: table.schema
          },
          mockUser
        );

        expect(columnsResult.success).toBe(true);
        expect(columnsResult.columns).toBeDefined();
      }
    });
  });
});
