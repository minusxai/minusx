/**
 * M2: groups are ADDITIVE. With no memberships, access is exactly role + home
 * (zero behavior change). Adding a user to a group grants that group's
 * capabilities over its folder scopes — verified end-to-end through the real
 * resolver + engine against a seeded DB. Also covers group CRUD round-trips.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import { getModules } from '@/lib/modules/registry';
import { searchFilesInFolder } from '@/lib/search/file-search';
import { createGroup, updateGroup, deleteGroup, listGroups, resolveUserGroupGrants, validateGroupInput } from '@/lib/data/groups.server';
import { resolveAccessPredicateWithGroups } from '@/lib/auth/access-resolver';
import { checkAccess } from '@/lib/auth/access-predicate';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { BaseFileContent } from '@/lib/types';

const DB = getTestDbPath('groups');
const viewer: EffectiveUser = { userId: 7, email: 'v@x.co', name: 'V', role: 'viewer', home_folder: 'sales', mode: 'org' };
const financeDash = { type: 'dashboard' as const, path: '/org/finance/report' };

beforeAll(async () => {
  await initTestDatabase(DB);
  await DocumentDB.create('report', '/org/finance/report', 'dashboard', {} as BaseFileContent, [], undefined, false);
}, 30_000);
afterAll(async () => { await cleanupTestDatabase(DB); });

describe('groups (M2) — additive grants', () => {

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

  it('group grants are mode-scoped (an org group does not grant in tutorial)', async () => {
    const g = await createGroup({ name: 'OrgOnly', mode: 'org', allowedTypes: '*', viewTypes: '*', createTypes: '*', scopes: ['finance'], memberIds: [9] });
    expect((await resolveUserGroupGrants(9, 'org')).length).toBe(1);
    expect(await resolveUserGroupGrants(9, 'tutorial')).toEqual([]);   // different mode → no grant
    await deleteGroup(g.id);
  });

  it('a user in multiple groups gets the union of grants', async () => {
    const a = await createGroup({ name: 'A', mode: 'org', allowedTypes: ['dashboard'], viewTypes: ['dashboard'], createTypes: [], scopes: ['finance'], memberIds: [10] });
    const b = await createGroup({ name: 'B', mode: 'org', allowedTypes: ['question'], viewTypes: ['question'], createTypes: [], scopes: ['marketing'], memberIds: [10] });
    const grants = await resolveUserGroupGrants(10, 'org');
    expect(grants.length).toBe(2);
    const viewer10: EffectiveUser = { userId: 10, email: 'a@b.co', name: 'X', role: 'viewer', home_folder: 'sales', mode: 'org' };
    const p = await resolveAccessPredicateWithGroups(viewer10);
    expect(checkAccess({ type: 'dashboard', path: '/org/finance/x' }, p, 'access')).toBe(true);  // via group A
    expect(checkAccess({ type: 'question', path: '/org/marketing/y' }, p, 'access')).toBe(true); // via group B
    expect(checkAccess({ type: 'question', path: '/org/finance/z' }, p, 'access')).toBe(false);  // A doesn't allow question in finance
    await deleteGroup(a.id); await deleteGroup(b.id);
  });

  it('locked groups reject edit and delete', async () => {
    const db = getModules().db;
    await db.exec(`INSERT INTO groups (name, mode, kind, allowed_types, view_types, create_types, locked) VALUES ('Admins','org','admin','"*"','"*"','"*"', true)`);
    const row = await db.exec<{ id: number }>(`SELECT id FROM groups WHERE name = 'Admins' AND mode = 'org'`, []);
    const id = row.rows[0].id;
    await expect(updateGroup(id, { name: 'x', mode: 'org', allowedTypes: '*', viewTypes: '*', createTypes: '*', scopes: [], memberIds: [] })).rejects.toThrow(/locked/i);
    await expect(deleteGroup(id)).rejects.toThrow(/locked/i);
    await db.exec(`DELETE FROM groups WHERE id = $1`, [id]); // cleanup (raw, bypassing the lock guard)
  });

  it('guests get base-only access — group grants never leak to them', async () => {
    // A guest is not a group member; the group-aware resolver must return only
    // the base predicate (a single grant) for them.
    const guest: EffectiveUser = { userId: 999999, email: 'g@x', name: 'G', role: 'viewer', home_folder: 'sales', mode: 'org', guest: { canChat: false, shareFileId: 1, nonce: 'n' } };
    const p = await resolveAccessPredicateWithGroups(guest);
    expect(p.grants.length).toBe(1);
    expect(checkAccess({ type: 'dashboard', path: '/org/finance/report' }, p, 'access')).toBe(false);
  });

  it('impersonation resolves the impersonated user\'s group grants', async () => {
    const g = await createGroup({ name: 'Imp', mode: 'org', allowedTypes: ['dashboard'], viewTypes: ['dashboard'], createTypes: [], scopes: ['finance'], memberIds: [7] });
    try {
      // getEffectiveUser builds an impersonated principal AS the target user
      // (the admin's ?as_user= yields the target's userId/home_folder/role) —
      // so grants must resolve by the target's id, which this exercises.
      const impersonated: EffectiveUser = { ...viewer };
      const p = await resolveAccessPredicateWithGroups(impersonated);
      expect(checkAccess(financeDash, p, 'access')).toBe(true);
    } finally {
      await deleteGroup(g.id);
    }
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

describe('group-aware read surfaces', () => {
  it('search returns group-granted files to a member (ui visibility)', async () => {
    const g = await createGroup({
      name: 'FinSearch', mode: 'org',
      allowedTypes: ['dashboard'], viewTypes: ['dashboard'], createTypes: [],
      scopes: ['finance'], memberIds: [7],
    });
    try {
      const res = await searchFilesInFolder({ query: 'report', folder_path: '/org', visibility: 'ui' }, viewer);
      expect(res.results.map(r => r.path)).toContain('/org/finance/report');
    } finally {
      await deleteGroup(g.id);
    }
  });

  it('search does NOT return the file to a non-member', async () => {
    const res = await searchFilesInFolder({ query: 'report', folder_path: '/org', visibility: 'ui' }, viewer);
    expect(res.results.map(r => r.path)).not.toContain('/org/finance/report');
  });
});

describe('validateGroupInput (API guard)', () => {
  const ok = { name: 'Team', allowedTypes: ['question'], viewTypes: ['question'], createTypes: [], scopes: ['finance'], memberIds: [1] };
  it('accepts a valid payload and carries the mode', () => {
    const r = validateGroupInput(ok, 'org');
    expect('input' in r && r.input.mode).toBe('org');
  });
  it('rejects a missing/blank name', () => {
    expect(validateGroupInput({ ...ok, name: '' }, 'org')).toHaveProperty('error');
    expect(validateGroupInput({ ...ok, name: undefined }, 'org')).toHaveProperty('error');
  });
  it('accepts "*" and arrays for capabilities, rejects junk', () => {
    expect(validateGroupInput({ ...ok, allowedTypes: '*' }, 'org')).toHaveProperty('input');
    expect(validateGroupInput({ ...ok, allowedTypes: 5 }, 'org')).toHaveProperty('error');
    expect(validateGroupInput({ ...ok, allowedTypes: [1, 2] }, 'org')).toHaveProperty('error');
  });
  it('rejects non-string scopes and non-integer members', () => {
    expect(validateGroupInput({ ...ok, scopes: [1] }, 'org')).toHaveProperty('error');
    expect(validateGroupInput({ ...ok, memberIds: ['x'] }, 'org')).toHaveProperty('error');
  });
});
