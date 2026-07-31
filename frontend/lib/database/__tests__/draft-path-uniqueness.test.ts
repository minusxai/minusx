/**
 * Drafts are exempt from path uniqueness (partial unique index `idx_files_path_published_unique`,
 * WHERE draft = false): multiple drafts can share a display path so the agent never collides when
 * creating new drafts, but PUBLISHED files must still have unique paths — and a draft can't be
 * published onto a path a published file already occupies.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initTestDatabase, cleanupTestDatabase, getTestDbPath } from '@/store/__tests__/test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
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

// EXISTING-DEPLOYMENT migration path: a pre-existing DB carried the legacy global UNIQUE(path)
// constraint (files_path_key), and a test here used to run the shipped DROP against a DB in that
// starting state, since the fresh-DB tests above never exercise it.
// The one-time upgrade off the legacy global UNIQUE(path) constraint shipped in
// 4972cb58 (2026-06-25) and ran on every boot thereafter, so no live database still
// carries it. The statement — and the test that exercised it — are retired; the
// draft-exempt behaviour itself stays covered by the cases above, which run against
// the real schema.
