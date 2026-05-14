import { buildCatalog, catalogToMarkdown, type CatalogData } from '../catalog';
import type { ConnectionInfo } from '../../types';
import type { SchemaEntry } from '@/lib/connections/base';

describe('buildCatalog', () => {
  const connections: ConnectionInfo[] = [
    { name: 'db1', dialect: 'duckdb', description: 'Test database', config: { file_path: 'test.duckdb' } },
    { name: 'db2', dialect: 'postgresql', description: 'Postgres DB', config: { database: 'test', username: 'user' } },
  ];

  const schemasByConnection = new Map<string, SchemaEntry[]>([
    ['db1', [
      {
        schema: 'main',
        tables: [
          {
            table: 'users',
            columns: [
              { name: 'id', type: 'INTEGER', meta: { category: 'numeric', min: 1, max: 1000 } },
              { name: 'name', type: 'VARCHAR', meta: { category: 'text', nDistinct: 500 } },
              { name: 'status', type: 'VARCHAR', meta: { category: 'categorical', nDistinct: 3, topValues: [{ value: 'active', count: 800, fraction: 0.8 }] } },
            ],
            indexes: [
              { name: 'users_pkey', columns: ['id'], unique: true },
            ],
          },
          {
            table: 'orders',
            columns: [
              { name: 'id', type: 'INTEGER' },
              { name: 'user_id', type: 'INTEGER' },
              { name: 'amount', type: 'DECIMAL' },
            ],
          },
        ],
      },
    ]],
    ['db2', [
      {
        schema: 'public',
        tables: [
          {
            table: 'products',
            columns: [
              { name: 'id', type: 'SERIAL' },
              { name: 'name', type: 'TEXT' },
            ],
          },
        ],
      },
    ]],
  ]);

  it('produces all 6 catalog tables', () => {
    const catalog = buildCatalog(connections, schemasByConnection);

    expect(catalog.connections).toBeDefined();
    expect(catalog.schemas).toBeDefined();
    expect(catalog.tables).toBeDefined();
    expect(catalog.columns).toBeDefined();
    expect(catalog.indexes).toBeDefined();
    expect(catalog.column_stats).toBeDefined();
  });

  it('populates connections table correctly', () => {
    const catalog = buildCatalog(connections, schemasByConnection);

    expect(catalog.connections).toHaveLength(2);
    expect(catalog.connections).toContainEqual({
      name: 'db1',
      dialect: 'duckdb',
      description: 'Test database',
    });
    expect(catalog.connections).toContainEqual({
      name: 'db2',
      dialect: 'postgresql',
      description: 'Postgres DB',
    });
  });

  it('populates schemas table correctly', () => {
    const catalog = buildCatalog(connections, schemasByConnection);

    expect(catalog.schemas).toHaveLength(2);
    expect(catalog.schemas).toContainEqual({ connection: 'db1', schema_name: 'main' });
    expect(catalog.schemas).toContainEqual({ connection: 'db2', schema_name: 'public' });
  });

  it('populates tables table correctly', () => {
    const catalog = buildCatalog(connections, schemasByConnection);

    expect(catalog.tables).toHaveLength(3);
    expect(catalog.tables).toContainEqual({
      connection: 'db1',
      schema_name: 'main',
      table_name: 'users',
      row_count: undefined,
    });
    expect(catalog.tables).toContainEqual({
      connection: 'db1',
      schema_name: 'main',
      table_name: 'orders',
      row_count: undefined,
    });
  });

  it('populates columns table with ordinal positions', () => {
    const catalog = buildCatalog(connections, schemasByConnection);

    const usersColumns = catalog.columns.filter(c => c.table_name === 'users');
    expect(usersColumns).toHaveLength(3);
    expect(usersColumns.find(c => c.column_name === 'id')?.ordinal_position).toBe(1);
    expect(usersColumns.find(c => c.column_name === 'name')?.ordinal_position).toBe(2);
    expect(usersColumns.find(c => c.column_name === 'status')?.ordinal_position).toBe(3);
  });

  it('populates indexes table', () => {
    const catalog = buildCatalog(connections, schemasByConnection);

    expect(catalog.indexes).toHaveLength(1);
    expect(catalog.indexes[0]).toEqual({
      connection: 'db1',
      schema_name: 'main',
      table_name: 'users',
      index_name: 'users_pkey',
      columns: 'id',
      is_unique: true,
    });
  });

  it('populates column_stats from meta', () => {
    const catalog = buildCatalog(connections, schemasByConnection);

    // Only columns with meaningful stats are included
    const statsForId = catalog.column_stats.find(
      s => s.column_name === 'id' && s.table_name === 'users'
    );
    expect(statsForId).toBeDefined();
    expect(statsForId?.category).toBe('numeric');
    expect(statsForId?.min).toBe(1);
    expect(statsForId?.max).toBe(1000);

    const statsForStatus = catalog.column_stats.find(
      s => s.column_name === 'status'
    );
    expect(statsForStatus).toBeDefined();
    expect(statsForStatus?.category).toBe('categorical');
    expect(statsForStatus?.n_distinct).toBe(3);
    expect(statsForStatus?.top_values).toBeDefined();
  });

  it('handles empty connections gracefully', () => {
    const catalog = buildCatalog([], new Map());

    expect(catalog.connections).toHaveLength(0);
    expect(catalog.schemas).toHaveLength(0);
    expect(catalog.tables).toHaveLength(0);
    expect(catalog.columns).toHaveLength(0);
  });
});

describe('catalogToMarkdown', () => {
  it('produces readable markdown tables', () => {
    const catalog: CatalogData = {
      connections: [{ name: 'db1', dialect: 'duckdb', description: 'Test' }],
      schemas: [{ connection: 'db1', schema_name: 'main' }],
      tables: [{ connection: 'db1', schema_name: 'main', table_name: 'users', row_count: 100 }],
      columns: [{ connection: 'db1', schema_name: 'main', table_name: 'users', column_name: 'id', data_type: 'INTEGER', ordinal_position: 1 }],
      indexes: [],
      column_stats: [],
    };

    const md = catalogToMarkdown(catalog);

    expect(md).toContain('## Connections');
    expect(md).toContain('| db1 | duckdb | Test |');
    expect(md).toContain('## Tables');
    expect(md).toContain('| db1 | main | users | 100 |');
    expect(md).toContain('## Columns');
    expect(md).toContain('| db1 | main | users | id | INTEGER |');
  });
});
