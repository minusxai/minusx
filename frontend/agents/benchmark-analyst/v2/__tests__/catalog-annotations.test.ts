import { buildCatalog, annotationsFingerprint } from '../catalog';
import type { CatalogConnector } from '../catalog';
import type { NodeConnector, SchemaEntry } from '@/lib/connections/base';
import type { TableAnnotation } from '@/lib/types';

const mockEntry = (name: string, schema: SchemaEntry[], dialect = 'duckdb'): CatalogConnector => ({
  connector: ({
    name,
    getSchema: vi.fn(async () => schema),
    query: vi.fn(async () => ({ columns: [], types: [], rows: [], finalQuery: '' })),
  }) as unknown as NodeConnector,
  dialect,
});

const SCHEMA: SchemaEntry[] = [
  {
    schema: 'public',
    tables: [
      {
        table: 'users',
        columns: [
          { name: 'id', type: 'INTEGER', meta: { category: 'numeric' } },
          // Profiled DB comment present on this column:
          { name: 'email', type: 'VARCHAR', meta: { category: 'text', description: 'Primary email (DB comment)' } },
        ],
      },
    ],
  },
];

const ANNOTATIONS: TableAnnotation[] = [
  {
    schema: 'public',
    table: 'users',
    description: 'Application users',
    columns: [{ name: 'id', description: 'Surrogate key' }],
  },
];

describe('catalog annotations + profiled descriptions', () => {
  it('columns catalog exposes distinct `description` (profiled) and `annotation` (editorial) columns', async () => {
    const connectors = new Map([['db1', mockEntry('db1', SCHEMA)]]);
    const catalog = await buildCatalog(connectors, undefined, ANNOTATIONS);

    expect(catalog.columns.columns).toContain('description');
    expect(catalog.columns.columns).toContain('annotation');

    const email = catalog.columns.rows.find((r) => r.column_name === 'email');
    const id = catalog.columns.rows.find((r) => r.column_name === 'id');

    // email: DB comment in `description`, no editorial annotation.
    expect(email?.description).toBe('Primary email (DB comment)');
    expect(email?.annotation).toBeFalsy();

    // id: editorial annotation in `annotation`, no DB comment.
    expect(id?.annotation).toBe('Surrogate key');
    expect(id?.description).toBeFalsy();
  });

  it('tables catalog exposes an `annotation` column from the table-level annotation', async () => {
    const connectors = new Map([['db1', mockEntry('db1', SCHEMA)]]);
    const catalog = await buildCatalog(connectors, undefined, ANNOTATIONS);

    expect(catalog.tables.columns).toContain('annotation');
    const users = catalog.tables.rows.find((r) => r.table_name === 'users');
    expect(users?.annotation).toBe('Application users');
  });

  it('still surfaces profiled `description` when no annotations are passed', async () => {
    const connectors = new Map([['db1', mockEntry('db1', SCHEMA)]]);
    const catalog = await buildCatalog(connectors);

    const email = catalog.columns.rows.find((r) => r.column_name === 'email');
    expect(email?.description).toBe('Primary email (DB comment)');
    expect(email?.annotation).toBeFalsy();
  });

  it('matches annotations by connection when specified, else wildcard', async () => {
    const connectors = new Map([['db1', mockEntry('db1', SCHEMA)]]);
    const scoped: TableAnnotation[] = [
      { schema: 'public', table: 'users', connection: 'OTHER', description: 'wrong conn' },
      { schema: 'public', table: 'users', columns: [{ name: 'email', description: 'right (wildcard)' }] },
    ];
    const catalog = await buildCatalog(connectors, undefined, scoped);
    const users = catalog.tables.rows.find((r) => r.table_name === 'users');
    // Table annotation was scoped to a different connection → not applied.
    expect(users?.annotation).toBeFalsy();
    const email = catalog.columns.rows.find((r) => r.column_name === 'email');
    expect(email?.annotation).toBe('right (wildcard)');
  });
});

describe('annotationsFingerprint (cache-key isolation)', () => {
  it('is empty for no annotations', () => {
    expect(annotationsFingerprint(undefined)).toBe('');
    expect(annotationsFingerprint([])).toBe('');
  });

  it('is stable for identical annotations and differs for different ones', () => {
    const a = annotationsFingerprint(ANNOTATIONS);
    const aAgain = annotationsFingerprint([...ANNOTATIONS]);
    const b = annotationsFingerprint([{ schema: 'public', table: 'users', description: 'Different' }]);
    expect(a).toBe(aAgain);
    expect(a).not.toBe(b);
    expect(a).not.toBe('');
  });
});
