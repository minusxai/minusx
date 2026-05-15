// Tests for buildCatalog: creates the 6 synthetic catalog tables from connection schemas
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SchemaEntry, NodeConnector, QueryResult } from '@/lib/connections/base';
import { buildCatalog, type CatalogTables } from '../catalog';

const mockConnector = (
  name: string,
  schema: SchemaEntry[],
): NodeConnector =>
  ({
    name,
    getSchema: vi.fn(async () => schema),
    query: vi.fn(async () => ({ columns: [], types: [], rows: [], finalQuery: '' })),
  }) as unknown as NodeConnector;

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
      const connectors = new Map([['db1', mockConnector('db1', SIMPLE_SCHEMA)]]);

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
        ['db1', mockConnector('db1', SIMPLE_SCHEMA)],
        ['db2', mockConnector('db2', [])],
      ]);

      const catalog = await buildCatalog(connectors);

      expect(catalog.connections.rows).toHaveLength(2);
      expect(catalog.connections.rows.map((r) => r.connection_name)).toEqual(['db1', 'db2']);
    });

    it('schemas table has one row per schema across all connections', async () => {
      const schema2: SchemaEntry[] = [{ schema: 'analytics', tables: [] }];
      const connectors = new Map([
        ['db1', mockConnector('db1', SIMPLE_SCHEMA)],
        ['db2', mockConnector('db2', schema2)],
      ]);

      const catalog = await buildCatalog(connectors);

      expect(catalog.schemas.rows).toHaveLength(2);
      expect(catalog.schemas.rows.map((r) => r.schema_name)).toContain('public');
      expect(catalog.schemas.rows.map((r) => r.schema_name)).toContain('analytics');
    });

    it('tables table has one row per table with row_count if available', async () => {
      const connectors = new Map([['db1', mockConnector('db1', SIMPLE_SCHEMA)]]);

      const catalog = await buildCatalog(connectors);

      expect(catalog.tables.rows).toHaveLength(2);
      const userTable = catalog.tables.rows.find((r) => r.table_name === 'users');
      expect(userTable?.connection_name).toBe('db1');
      expect(userTable?.schema_name).toBe('public');
    });

    it('columns table has one row per column with type', async () => {
      const connectors = new Map([['db1', mockConnector('db1', SIMPLE_SCHEMA)]]);

      const catalog = await buildCatalog(connectors);

      const userColumns = catalog.columns.rows.filter(
        (r) => r.table_name === 'users',
      );
      expect(userColumns).toHaveLength(3);
      expect(userColumns.map((c) => c.column_name)).toEqual(['id', 'email', 'status']);
    });

    it('indexes table has one row per index', async () => {
      const connectors = new Map([['db1', mockConnector('db1', SIMPLE_SCHEMA)]]);

      const catalog = await buildCatalog(connectors);

      expect(catalog.indexes.rows).toHaveLength(2);
      const pkeyIdx = catalog.indexes.rows.find((r) => r.index_name === 'users_pkey');
      expect(pkeyIdx?.columns).toBe('id');
      expect(pkeyIdx?.is_unique).toBe(true);
    });

    it('column_stats table contains stats from column meta', async () => {
      const connectors = new Map([['db1', mockConnector('db1', SIMPLE_SCHEMA)]]);

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

      const connectors = new Map([['bare_db', connector]]);

      const catalog = await buildCatalog(connectors);

      expect(catalog.column_stats.rows.length).toBeGreaterThan(0);
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
      const connectors = new Map([['empty', mockConnector('empty', [])]]);

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
      const connectors = new Map([['db', mockConnector('db', schemaNoIndexes)]]);

      const catalog = await buildCatalog(connectors);

      expect(catalog.indexes.rows).toHaveLength(0);
    });
  });
});
