/**
 * Startup migration runner — row-migration path.
 *
 * The whole-DB path (exportDatabase → applyMigrations → atomicImport) materializes
 * every files row in memory and OOMs on production-sized tables. Migrations that
 * only rewrite specific file types declare a `rowMigration`; when every pending
 * migration has one, runMigrationsIfNeeded scans just those types in batches and
 * UPDATEs changed rows in place — exportDatabase must never be called.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('@/lib/database/import-export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/database/import-export')>();
  return { ...actual, exportDatabase: vi.fn(actual.exportDatabase) };
});

import { initTestDatabase, cleanupTestDatabase, getTestDbPath } from '@/store/__tests__/test-utils';
import { runMigrationsIfNeeded, runRowMigration } from '@/lib/database/run-migrations';
import { exportDatabase } from '@/lib/database/import-export';
import { getDataVersion, setDataVersion } from '@/lib/database/config-store';
import { DocumentDB } from '@/lib/database/documents-db';
import { MIGRATIONS } from '@/lib/database/migrations';
import { LATEST_DATA_VERSION } from '@/lib/database/constants';

const dbPath = getTestDbPath('run_migrations_row_path');

const legacyQuestionContent = {
  query: 'SELECT region, revenue FROM sales',
  vizSettings: { type: 'bar', xCols: ['region'], yCols: ['revenue'] },
  connection_name: 'db',
};

const legacyNotebookContent = {
  description: null,
  cells: [
    {
      type: 'sql', id: 'c1', name: null, query: 'SELECT 1',
      vizSettings: { type: 'line', xCols: ['order_date'], yCols: ['n'] },
      parameters: [], parameterValues: {}, connection_name: 'db',
    },
    { type: 'text', id: 'c2', name: null, content: 'hello' },
  ],
};

// A hand-authored envelope with a sentinel value — must never be overwritten.
const handAuthoredViz = {
  version: 2,
  source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: 'sentinel-css' },
};

beforeAll(async () => { await initTestDatabase(dbPath); });
afterAll(async () => { await cleanupTestDatabase(dbPath); });

// ──────────────────────────────────────────────────────────────────────────────
// Registry contract — v37 declares a row migration
// ──────────────────────────────────────────────────────────────────────────────

describe('v37 rowMigration (registry contract)', () => {
  const entry = MIGRATIONS.find(m => m.dataVersion === 37)!;

  it('declares a row migration scoped to question and notebook', () => {
    expect(entry.rowMigration).toBeDefined();
    expect([...entry.rowMigration!.types].sort()).toEqual(['notebook', 'question']);
  });

  it('returns migrated content for a question lacking a viz envelope', () => {
    const next = entry.rowMigration!.migrateContent({
      id: 1, type: 'question', content: structuredClone(legacyQuestionContent),
    }) as any;
    expect(next?.viz?.version).toBe(2);
    expect(next.vizSettings).toEqual(legacyQuestionContent.vizSettings);
  });

  it('returns null (no write) for a question that already has a viz envelope', () => {
    const content = { ...structuredClone(legacyQuestionContent), viz: handAuthoredViz };
    expect(entry.rowMigration!.migrateContent({ id: 1, type: 'question', content })).toBeNull();
  });

  it('migrates notebook SQL cells and leaves text cells untouched', () => {
    const next = entry.rowMigration!.migrateContent({
      id: 1, type: 'notebook', content: structuredClone(legacyNotebookContent),
    }) as any;
    expect(next?.cells[0].viz?.version).toBe(2);
    expect(next.cells[0].vizSettings).toEqual(legacyNotebookContent.cells[0].vizSettings);
    expect(next.cells[1]).toEqual(legacyNotebookContent.cells[1]);
  });

  it('returns null for a notebook whose SQL cells all have envelopes already', () => {
    const content = structuredClone(legacyNotebookContent);
    (content.cells[0] as any).viz = handAuthoredViz;
    expect(entry.rowMigration!.migrateContent({ id: 1, type: 'notebook', content })).toBeNull();
  });

  it('produces the same content as the whole-DB dataMigration for the same doc', () => {
    const doc = {
      id: 1, name: 'q', path: '/org/q', type: 'question' as const,
      content: structuredClone(legacyQuestionContent) as any,
      references: [], version: 1, last_edit_id: null,
      created_at: '2024-01-01', updated_at: '2024-01-01',
    };
    const wholeDb = entry.dataMigration!({ version: 36, users: [], documents: [doc] });
    const rowWise = entry.rowMigration!.migrateContent({
      id: 1, type: 'question', content: structuredClone(legacyQuestionContent),
    });
    expect(rowWise).toEqual(wholeDb.documents![0].content);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// runMigrationsIfNeeded — end to end against a real (PGLite) DB
// ──────────────────────────────────────────────────────────────────────────────

describe('runMigrationsIfNeeded — row path (v36 → v37)', () => {
  it('migrates via row updates WITHOUT exporting the whole DB', async () => {
    const qId = await DocumentDB.create('Legacy Q', '/org/legacy-q', 'question',
      structuredClone(legacyQuestionContent) as any, []);
    const nbId = await DocumentDB.create('Legacy NB', '/org/legacy-nb', 'notebook',
      structuredClone(legacyNotebookContent) as any, []);
    const doneId = await DocumentDB.create('Done Q', '/org/done-q', 'question',
      { ...structuredClone(legacyQuestionContent), viz: handAuthoredViz } as any, []);

    await setDataVersion(36);
    vi.mocked(exportDatabase).mockClear();

    await runMigrationsIfNeeded();

    expect(await getDataVersion()).toBe(LATEST_DATA_VERSION);
    expect(exportDatabase).not.toHaveBeenCalled();

    const q = (await DocumentDB.getById(qId))!.content as any;
    expect(q.viz?.version).toBe(2);
    expect(q.vizSettings).toEqual(legacyQuestionContent.vizSettings);

    const nb = (await DocumentDB.getById(nbId))!.content as any;
    expect(nb.cells[0].viz?.version).toBe(2);
    expect(nb.cells[1]).toEqual(legacyNotebookContent.cells[1]);

    // Hand-authored envelope survives untouched.
    const done = (await DocumentDB.getById(doneId))!.content as any;
    expect(done.viz).toEqual(handAuthoredViz);
  });

  it('is a no-op when already at the latest version', async () => {
    expect(await getDataVersion()).toBe(LATEST_DATA_VERSION);
    vi.mocked(exportDatabase).mockClear();
    await runMigrationsIfNeeded();
    expect(exportDatabase).not.toHaveBeenCalled();
    expect(await getDataVersion()).toBe(LATEST_DATA_VERSION);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// runRowMigration — keyset batching
// ──────────────────────────────────────────────────────────────────────────────

describe('runRowMigration — batching', () => {
  it('visits every matching row across multiple batches (keyset pagination)', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(await DocumentDB.create(`Batch Q ${i}`, `/org/batch-q-${i}`, 'question',
        structuredClone(legacyQuestionContent) as any, []));
    }
    // Rows of other types must never be handed to migrateContent.
    await DocumentDB.create('Untouched Dash', '/org/batch-dash', 'dashboard',
      { assets: [], layout: [] } as any, []);

    const seen: Array<{ id: number; type: string }> = [];
    const v37 = MIGRATIONS.find(m => m.dataVersion === 37)!.rowMigration!;
    await runRowMigration({
      types: v37.types,
      migrateContent: (row) => { seen.push({ id: row.id, type: row.type }); return v37.migrateContent(row); },
    }, 2); // batch size 2 → 5 target rows span 3 batches

    for (const id of ids) {
      expect(seen.some(s => s.id === id)).toBe(true);
      const content = (await DocumentDB.getById(id))!.content as any;
      expect(content.viz?.version).toBe(2);
    }
    expect(seen.every(s => s.type === 'question' || s.type === 'notebook')).toBe(true);
  });
});
