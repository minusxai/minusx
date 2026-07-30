/**
 * An export/import round-trip must return the file it was given.
 *
 * `exportDatabase` builds each document by listing fields one at a time, and
 * `importToDatabase` lists the INSERT columns the same way. Two columns on `files` were
 * missing from both lists, and nothing failed when they were: the import simply took the
 * column defaults. So a round-trip published every draft and dropped `meta` — which
 * carries share grants, the thing `idx_files_meta_shares` exists to index. Silent, and
 * only visible by comparing a file with the file it came from.
 *
 * This asserts the whole row survives rather than naming the two that went missing,
 * because the next field added to `BaseFileMetadata` will go missing the same way.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initTestDatabase, cleanupTestDatabase, getTestDbPath } from '@/store/__tests__/test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import { exportDatabase, atomicImport } from '@/lib/database/import-export';
import type { BaseFileContent } from '@/lib/types';

const dbPath = getTestDbPath('export_import_round_trip');
const content = { description: 'round trip' } as BaseFileContent;

beforeAll(async () => { await initTestDatabase(dbPath); });
afterAll(async () => { await cleanupTestDatabase(dbPath); });

describe('export → import round-trip', () => {
  it('preserves every persisted field of a file, not just the ones spelled out', async () => {
    const shares = { shares: [{ email: 'someone@example.com', role: 'viewer' }] };
    const draftId = await DocumentDB.create(
      'Draft With Meta', '/org/RoundTrip-Draft', 'question', content, [], undefined, true, shares,
    );

    const before = await DocumentDB.getById(draftId);
    expect(before?.draft).toBe(true);
    expect(before?.meta).toEqual(shares);

    const exported = await exportDatabase();
    await atomicImport(exported);

    const after = await DocumentDB.getById(draftId);

    // The two that were being dropped — called out because each fails differently:
    // a published draft can collide on the published-path unique index, and a lost
    // `meta` silently revokes every share on the file.
    expect(after?.draft).toBe(true);
    expect(after?.meta).toEqual(shares);

    // And the general property: nothing else quietly changed either.
    expect(after).toMatchObject({
      name: before!.name,
      path: before!.path,
      type: before!.type,
      version: before!.version,
    });
  });

  it('still imports an export written before those fields were carried', async () => {
    // Old files on disk have no `draft`/`meta` keys at all. They must land on the column
    // defaults rather than failing the INSERT.
    const exported = await exportDatabase();
    const legacy = {
      ...exported,
      documents: exported.documents!.map(({ ...d }) => {
        delete (d as Record<string, unknown>).draft;
        delete (d as Record<string, unknown>).meta;
        return d;
      }),
    };

    await expect(atomicImport(legacy)).resolves.not.toThrow();
  });
});
