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

  it('dryRun is READ-ONLY: no write statement is ever issued', async () => {
    // The preflight must never write. Write-then-rollback is not equivalent:
    // on the pooled Postgres backend each exec can use a different pool client,
    // so BEGIN/ROLLBACK do not bracket the updates and a "rolled back" preflight
    // actually commits. Read-only is the only version that is correct everywhere.
    const draftId = await mk('Preflight', '/org/Preflight', true);
    const { getModules } = await import('@/lib/modules/registry');
    const db = getModules().db;
    const spy = vi.spyOn(db, 'exec');
    try {
      const res = await DocumentDB.batchSave([
        { id: draftId, name: 'Preflight', path: '/org/Preflight', content, references: [] },
      ], true);
      expect(res.success).toBe(true);
      const writes = spy.mock.calls.filter(([sql]) =>
        /^\s*(UPDATE|INSERT|DELETE|BEGIN|COMMIT|ROLLBACK)/i.test(String(sql)));
      expect(writes).toEqual([]);
    } finally {
      spy.mockRestore();
    }
    const row = await DocumentDB.getById(draftId);
    expect(row?.draft).toBe(true);
  });

  it('dryRun reports a publish-path conflict without writing', async () => {
    await mk('Owner2', '/org/Taken2', false);
    const draftId = await mk('Contender2', '/org/Taken2', true);
    const res = await DocumentDB.batchSave([
      { id: draftId, name: 'Contender2', path: '/org/Taken2', content, references: [] },
    ], true);
    expect(res.success).toBe(false);
    expect(res.errors[0].id).toBe(draftId);
    expect(res.errors[0].error).toMatch(/already exists|rename/i);
    expect((await DocumentDB.getById(draftId))?.draft).toBe(true);
  });

  it('dryRun catches two batch entries publishing to the SAME path', async () => {
    const a = await mk('Dup A', '/org/DupTarget', true);
    const b = await mk('Dup B', '/org/DupTarget', true);
    const res = await DocumentDB.batchSave([
      { id: a, name: 'Dup A', path: '/org/DupTarget', content, references: [] },
      { id: b, name: 'Dup B', path: '/org/DupTarget', content, references: [] },
    ], true);
    expect(res.success).toBe(false);
    expect(res.errors[0].error).toMatch(/already exists|rename/i);
  });

  it('a real batch is all-or-nothing: a conflict on ANY entry leaves every entry unwritten', async () => {
    await mk('Blocker', '/org/Blocked', false);
    const okId = await mk('Fine', '/org/Fine', true);
    const badId = await mk('Collides', '/org/Blocked', true);
    const res = await DocumentDB.batchSave([
      { id: okId, name: 'Fine', path: '/org/Fine', content, references: [] },
      { id: badId, name: 'Collides', path: '/org/Blocked', content, references: [] },
    ]);
    expect(res.success).toBe(false);
    // The conflict-free first entry must not have been published either.
    expect((await DocumentDB.getById(okId))?.draft).toBe(true);
    expect((await DocumentDB.getById(badId))?.draft).toBe(true);
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
