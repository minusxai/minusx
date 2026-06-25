/**
 * Drafts are exempt from path uniqueness (partial unique index `idx_files_path_published_unique`,
 * WHERE draft = false): multiple drafts can share a display path so the agent never collides when
 * creating new drafts, but PUBLISHED files must still have unique paths — and a draft can't be
 * published onto a path a published file already occupies.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { initTestDatabase, cleanupTestDatabase, getTestDbPath } from '@/store/__tests__/test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import { POSTGRES_SCHEMA, splitSQLStatements } from '@/lib/database/postgres-schema';
import type { BaseFileContent } from '@/lib/types';

const dbPath = getTestDbPath('draft_path_uniqueness');
const content = { description: '' } as BaseFileContent;
const mk = (name: string, path: string, draft: boolean) =>
  DocumentDB.create(name, path, 'question', content, [], undefined, draft);

beforeAll(async () => { await initTestDatabase(dbPath); });
afterAll(async () => { await cleanupTestDatabase(dbPath); });

describe('draft path uniqueness (partial unique index)', () => {
  it('allows MULTIPLE DRAFTS at the same path', async () => {
    const id1 = await mk('Draft A', '/org/Report', true);
    const id2 = await mk('Draft B', '/org/Report', true);
    const id3 = await mk('Draft C', '/org/Report', true);
    expect(new Set([id1, id2, id3]).size).toBe(3);
  });

  it('rejects two PUBLISHED files at the same path', async () => {
    await mk('Pub A', '/org/Pub', false);
    await expect(mk('Pub B', '/org/Pub', false)).rejects.toThrow();
  });

  it('publishing a draft to a path a PUBLISHED file occupies is rejected with a rename message', async () => {
    await mk('Owner', '/org/Taken', false);
    const draftId = await mk('Contender', '/org/Taken', true); // draft at the same path — allowed
    const res = await DocumentDB.batchSave([
      { id: draftId, name: 'Contender', path: '/org/Taken', content, references: [] },
    ]);
    expect(res.success).toBe(false);
    expect(res.errors[0].error).toMatch(/already exists|rename/i);
    // the draft stays a draft (transaction rolled back)
    const row = await DocumentDB.getById(draftId);
    expect(row?.draft).toBe(true);
  });

  it('getByPath prefers the PUBLISHED file when a draft shares its path', async () => {
    const pubId = await mk('Canonical', '/org/Shadowed', false);
    await mk('Shadow draft', '/org/Shadowed', true);
    const found = await DocumentDB.getByPath('/org/Shadowed');
    expect(found?.id).toBe(pubId);
    expect(found?.draft).toBe(false);
  });

  it('publishing a draft to a FREE path succeeds', async () => {
    const draftId = await mk('Solo', '/org/Solo', true);
    const res = await DocumentDB.batchSave([
      { id: draftId, name: 'Solo', path: '/org/Solo', content, references: [] },
    ]);
    expect(res.success).toBe(true);
    const row = await DocumentDB.getById(draftId);
    expect(row?.draft).toBe(false);
  });
});

// EXISTING-DEPLOYMENT migration path: a pre-existing DB has the legacy global UNIQUE(path)
// constraint (files_path_key). The fresh-DB tests above never exercise the DROP — this runs the
// REAL shipped migration statements against a DB that has the constraint, to prove they cleanly
// drop it and install the partial index. Uses raw PGLite so we control the starting (legacy) state.
describe('draft path uniqueness — existing-DB migration (drops legacy files_path_key)', () => {
  it('runs the shipped migration SQL and flips behavior to draft-exempt', async () => {
    const db = new PGlite();
    // Simulate an OLD database: files table WITH the legacy global UNIQUE(path) constraint.
    await db.exec(
      `CREATE TABLE files (id INTEGER PRIMARY KEY, path TEXT NOT NULL,
        draft BOOLEAN NOT NULL DEFAULT FALSE, CONSTRAINT files_path_key UNIQUE (path))`
    );
    await db.exec(`INSERT INTO files (id, path, draft) VALUES (1, '/org/X', false)`);
    // Legacy constraint blocks ANY duplicate path — even a draft.
    await expect(
      db.exec(`INSERT INTO files (id, path, draft) VALUES (2, '/org/X', true)`)
    ).rejects.toThrow();

    // Apply ONLY the real migration statements from the shipped schema (no inline copy → no drift).
    const migration = splitSQLStatements(POSTGRES_SCHEMA).filter(
      (s) => /files_path_key/.test(s) || /idx_files_path_published_unique/.test(s)
    );
    expect(migration.length).toBeGreaterThanOrEqual(2); // the DROP-constraint DO block + the index
    for (const stmt of migration) await db.exec(stmt);

    // After migration: a DRAFT duplicate is now allowed...
    await db.exec(`INSERT INTO files (id, path, draft) VALUES (2, '/org/X', true)`);
    // ...but a second PUBLISHED row at the same path is still rejected by the partial index.
    await expect(
      db.exec(`INSERT INTO files (id, path, draft) VALUES (3, '/org/X', false)`)
    ).rejects.toThrow();
    await db.close();
  });
});
