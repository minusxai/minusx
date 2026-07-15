/**
 * M2: groups are ADDITIVE. With no memberships, access is exactly role + home
 * (zero behavior change). Adding a user to a group grants that group's
 * capabilities over its folder scopes — verified end-to-end through the real
 * resolver + engine against a seeded DB. Also covers group CRUD round-trips.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import { createGroup, updateGroup, deleteGroup, listGroups, resolveUserGroupGrants } from '@/lib/data/groups.server';
import { resolveAccessPredicateWithGroups } from '@/lib/auth/access-resolver';
import { checkAccess } from '@/lib/auth/access-predicate';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { BaseFileContent } from '@/lib/types';

const DB = getTestDbPath('groups');
const viewer: EffectiveUser = { userId: 7, email: 'v@x.co', name: 'V', role: 'viewer', home_folder: 'sales', mode: 'org' };
const financeDash = { type: 'dashboard' as const, path: '/org/finance/report' };

describe('groups (M2) — additive grants', () => {
  beforeAll(async () => {
    await initTestDatabase(DB);
    await DocumentDB.create('report', '/org/finance/report', 'dashboard', {} as BaseFileContent, [], undefined, false);
  }, 30_000);
  afterAll(async () => { await cleanupTestDatabase(DB); });

  it('no memberships → base-only (a sales viewer cannot reach /org/finance)', async () => {
    const p = await resolveAccessPredicateWithGroups(viewer);
    expect(checkAccess(financeDash, p, 'access')).toBe(false);
  });

  it('adding the viewer to a Finance group grants access to /org/finance', async () => {
    const g = await createGroup({
      name: 'Finance', mode: 'org',
      allowedTypes: ['dashboard', 'question'], viewTypes: ['dashboard', 'question'], createTypes: [],
      scopes: ['finance'], memberIds: [7],
    });
    expect((await resolveUserGroupGrants(7, 'org')).length).toBe(1);

    const p = await resolveAccessPredicateWithGroups(viewer);
    expect(checkAccess(financeDash, p, 'access')).toBe(true);           // granted via the group
    // A type outside the group's capabilities, only reachable via the group path, is NOT granted.
    expect(checkAccess({ type: 'connection', path: '/org/finance/x' }, p, 'access')).toBe(false);

    await deleteGroup(g.id);
    expect(await resolveUserGroupGrants(7, 'org')).toEqual([]);          // removal reverts to base
    expect(checkAccess(financeDash, await resolveAccessPredicateWithGroups(viewer), 'access')).toBe(false);
  });

  it('list / update / delete round-trip', async () => {
    const g = await createGroup({
      name: 'Team', mode: 'org', allowedTypes: '*', viewTypes: '*', createTypes: '*',
      scopes: ['marketing', 'sales'], memberIds: [7, 8],
    });
    const found = (await listGroups('org')).find(x => x.id === g.id)!;
    expect([...found.scopes].sort()).toEqual(['marketing', 'sales']);
    expect([...found.memberIds].sort()).toEqual([7, 8]);

    const upd = await updateGroup(g.id, {
      name: 'Team2', mode: 'org', allowedTypes: ['question'], viewTypes: ['question'], createTypes: ['question'],
      scopes: ['marketing'], memberIds: [7],
    });
    expect(upd.name).toBe('Team2');
    expect(upd.scopes).toEqual(['marketing']);
    expect(upd.memberIds).toEqual([7]);
    expect(upd.allowedTypes).toEqual(['question']);

    await deleteGroup(g.id);
    expect((await listGroups('org')).find(x => x.id === g.id)).toBeUndefined();
  });
});
