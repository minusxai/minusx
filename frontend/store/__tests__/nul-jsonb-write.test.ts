/**
 * Regression: a raw NUL (U+0000) in tool output / query-result cells used to poison the
 * conversation-log / file-content jsonb write, surfacing as `unsupported Unicode escape sequence`
 * (Sentry MINUSX-BI-2T, chatListener:completeToolCall on a hosted Postgres deployment). DocumentDB
 * now strips NUL at the write boundary, so these writes succeed and store the value NUL-free.
 */
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from './test-utils';
import { DocumentDB } from '@/lib/database/documents-db';

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

const NUL = String.fromCharCode(0);

describe('DocumentDB — NUL bytes in jsonb writes', () => {
  const dbPath = getTestDbPath('nul-jsonb-write');
  beforeAll(async () => { await initTestDatabase(dbPath); });
  afterAll(async () => { await cleanupTestDatabase(dbPath); });

  it('create() with a NUL in content succeeds and stores it stripped', async () => {
    const content = { log: [{ role: 'tool', text: `cell${NUL}value` }] } as any;
    const id = await DocumentDB.create('conv-nul', '/org/conv-nul', 'conversation', content, []);
    const stored = await DocumentDB.getById(id);
    expect((stored!.content as any).log[0].text).toBe('cellvalue');
  });

  it('appendJsonArray() with a NUL in an entry succeeds and stores it stripped', async () => {
    const id = await DocumentDB.create(
      'conv-append',
      '/org/conv-append',
      'conversation',
      { log: [], metadata: { updatedAt: '' } } as any,
      [],
    );
    const ok = await DocumentDB.appendJsonArray(
      id,
      [{ role: 'tool', text: `append${NUL}ed` }],
      undefined,
      'log',
      'metadata.updatedAt',
    );
    expect(ok).toBe(true);
    const stored = await DocumentDB.getById(id);
    expect((stored!.content as any).log[0].text).toBe('appended');
  });
});
