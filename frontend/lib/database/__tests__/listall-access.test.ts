/**
 * M1b integration: DocumentDB.listAll's optional access predicate must filter
 * rows in SQL to EXACTLY what checkAccess would accept post-fetch — against a
 * real seeded database. Proves the predicate plumbs in at the right param
 * offset and composes with the existing type/path/draft conditions.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import { resolveAccessPredicate } from '@/lib/auth/access-resolver';
import { checkAccess } from '@/lib/auth/access-predicate';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { BaseFileContent } from '@/lib/types';

const DB = getTestDbPath('access_listall');

function u(role: EffectiveUser['role'], home_folder: string): EffectiveUser {
  return { userId: role === 'admin' ? 1 : 2, email: 'e@x.co', name: 'E', role, home_folder, mode: 'org' };
}

describe('DocumentDB.listAll SQL access predicate (real DB)', () => {
  beforeAll(async () => {
    await initTestDatabase(DB);
    const mk = (path: string, type = 'question') =>
      DocumentDB.create(path.split('/').pop()!, path, type, {} as BaseFileContent, [], undefined, false);
    await mk('/org/sales/q1');
    await mk('/org/marketing/m1');
    await mk('/org/database/pg', 'connection');
  }, 30_000);
  afterAll(async () => { await cleanupTestDatabase(DB); });

  it('scoped editor: SQL-filtered set === checkAccess-filtered set', async () => {
    const p = resolveAccessPredicate(u('editor', 'sales'));
    const all = await DocumentDB.listAll(undefined, undefined, undefined, false);
    const scoped = await DocumentDB.listAll(undefined, undefined, undefined, false, { predicate: p, variant: 'access' });
    expect(new Set(scoped.map(f => f.id)))
      .toEqual(new Set(all.filter(f => checkAccess(f, p, 'access')).map(f => f.id)));
    const paths = scoped.map(f => f.path);
    expect(paths).toContain('/org/sales/q1');       // in home scope
    expect(paths).toContain('/org/database/pg');    // system scope (all users)
    expect(paths).not.toContain('/org/marketing/m1'); // outside scope
  });

  it('admin: SQL-filtered set === checkAccess-filtered set (whole mode)', async () => {
    const p = resolveAccessPredicate(u('admin', ''));
    const all = await DocumentDB.listAll(undefined, undefined, undefined, false);
    const scoped = await DocumentDB.listAll(undefined, undefined, undefined, false, { predicate: p, variant: 'access' });
    expect(new Set(scoped.map(f => f.id)))
      .toEqual(new Set(all.filter(f => checkAccess(f, p, 'access')).map(f => f.id)));
  });

  it('composes with a type filter (params stay aligned)', async () => {
    const p = resolveAccessPredicate(u('editor', 'sales'));
    const scoped = await DocumentDB.listAll('question', undefined, undefined, false, { predicate: p, variant: 'access' });
    expect(scoped.every(f => f.type === 'question')).toBe(true);
    expect(scoped.map(f => f.path)).toContain('/org/sales/q1');
    expect(scoped.map(f => f.path)).not.toContain('/org/database/pg'); // connection type filtered out
  });
});
