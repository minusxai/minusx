/**
 * Access V2 groups — CONFIG-STORED (no tables): definitions live in the org
 * config document's `groups` section; membership is the `groups` array on the
 * users table (group names). Roles are the built-in groups (`role` column);
 * custom groups are purely ADDITIVE on top.
 *
 * Written red-first against the target API. Covers: base-only default,
 * additive grant, multi-group union (3 groups), nested overlapping scopes,
 * mode scoping, removal/deletion revert, delete-in-use refusal, reserved
 * names, dangling membership, guests, and search integration.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import { UserDB } from '@/lib/database/user-db';
import { searchFilesInFolder } from '@/lib/search/file-search';
import {
  listGroups, createGroup, updateGroup, deleteGroup, resolveUserGroupGrants, validateGroupInput,
} from '@/lib/data/groups.server';
import { resolveAccessPredicateWithGroups } from '@/lib/auth/access-resolver';
import { checkAccess } from '@/lib/auth/access-predicate';
import { validateGroupsSection } from '@/lib/validation/config-validators';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { BaseFileContent, FileType } from '@/lib/types';

const DB = getTestDbPath('groups');
const adminUser: EffectiveUser = { userId: 1, email: 'admin@x.co', name: 'A', role: 'admin', home_folder: '', mode: 'org' };
let viewerId: number;
let viewer: EffectiveUser;
const financeDash = { type: 'dashboard' as const, path: '/org/finance/report' };

beforeAll(async () => {
  await initTestDatabase(DB);
  await DocumentDB.create('report', '/org/finance/report', 'dashboard', {} as BaseFileContent, [], undefined, false);
  viewerId = await UserDB.create('v@x.co', 'V', 'sales', { role: 'viewer', password_hash: 'h' });
  viewer = { userId: viewerId, email: 'v@x.co', name: 'V', role: 'viewer', home_folder: 'sales', mode: 'org' };
}, 30_000);
afterAll(async () => { await cleanupTestDatabase(DB); });

interface GInput { name: string; allowedTypes: '*' | FileType[]; viewTypes: '*' | FileType[]; createTypes: '*' | FileType[]; folders: string[]; memberIds: number[] }
const groupInput = (name: string, over: Partial<GInput> = {}): GInput => ({
  name,
  allowedTypes: ['dashboard', 'question'],
  viewTypes: ['dashboard', 'question'],
  createTypes: [],
  folders: ['finance'],
  memberIds: [],
  ...over,
});

describe('config-stored groups — semantics', () => {
  it('no groups / no membership → base-only (sales viewer cannot reach /org/finance)', async () => {
    expect(await resolveUserGroupGrants(viewerId, 'org')).toEqual([]);
    const p = await resolveAccessPredicateWithGroups(viewer);
    expect(p.grants.length).toBe(1);
    expect(checkAccess(financeDash, p, 'access')).toBe(false);
  });

  it('membership in a config-defined group grants access; deletion reverts it', async () => {
    await createGroup(groupInput('finance-team', { memberIds: [viewerId] }), adminUser);
    const p = await resolveAccessPredicateWithGroups(viewer);
    expect(checkAccess(financeDash, p, 'access')).toBe(true);
    // capability-bounded: connection not in the group's types
    expect(checkAccess({ type: 'connection', path: '/org/finance/x' }, p, 'access')).toBe(false);

    await updateGroup('finance-team', groupInput('finance-team', { memberIds: [] }), adminUser);
    await deleteGroup('finance-team', adminUser);
    expect(checkAccess(financeDash, await resolveAccessPredicateWithGroups(viewer), 'access')).toBe(false);
  });

  it('a user in THREE groups gets the union; per-group capability ∩ scope holds', async () => {
    await createGroup(groupInput('g-dash', { allowedTypes: ['dashboard'], viewTypes: ['dashboard'], folders: ['finance'], memberIds: [viewerId] }), adminUser);
    await createGroup(groupInput('g-q', { allowedTypes: ['question'], viewTypes: ['question'], folders: ['marketing'], memberIds: [viewerId] }), adminUser);
    await createGroup(groupInput('g-notebook', { allowedTypes: ['notebook'], viewTypes: ['notebook'], folders: ['research'], memberIds: [viewerId] }), adminUser);
    try {
      const p = await resolveAccessPredicateWithGroups(viewer);
      expect((await resolveUserGroupGrants(viewerId, 'org')).length).toBe(3);
      expect(checkAccess({ type: 'dashboard', path: '/org/finance/a' }, p, 'access')).toBe(true);
      expect(checkAccess({ type: 'question', path: '/org/marketing/b' }, p, 'access')).toBe(true);
      expect(checkAccess({ type: 'notebook', path: '/org/research/c' }, p, 'access')).toBe(true);
      // cross-grant leakage must NOT happen (capability ∩ scope per group):
      expect(checkAccess({ type: 'question', path: '/org/finance/a' }, p, 'access')).toBe(false);
      expect(checkAccess({ type: 'dashboard', path: '/org/marketing/b' }, p, 'access')).toBe(false);
    } finally {
      for (const n of ['g-dash', 'g-q', 'g-notebook']) {
        await updateGroup(n, groupInput(n, { memberIds: [] }), adminUser);
        await deleteGroup(n, adminUser);
      }
    }
  });

  it('nested overlapping scopes: /finance group + /finance/q1 group union cleanly', async () => {
    await createGroup(groupInput('outer', { allowedTypes: ['dashboard'], viewTypes: ['dashboard'], folders: ['finance'], memberIds: [viewerId] }), adminUser);
    await createGroup(groupInput('inner', { allowedTypes: ['question'], viewTypes: ['question'], folders: ['finance/q1'], memberIds: [viewerId] }), adminUser);
    try {
      const p = await resolveAccessPredicateWithGroups(viewer);
      expect(checkAccess({ type: 'dashboard', path: '/org/finance/q1/deep' }, p, 'access')).toBe(true); // via outer
      expect(checkAccess({ type: 'question', path: '/org/finance/q1/deep' }, p, 'access')).toBe(true);  // via inner
      expect(checkAccess({ type: 'question', path: '/org/finance/other' }, p, 'access')).toBe(false);   // inner is bounded
    } finally {
      for (const n of ['outer', 'inner']) {
        await updateGroup(n, groupInput(n, { memberIds: [] }), adminUser);
        await deleteGroup(n, adminUser);
      }
    }
  });

  it('group definitions are mode-scoped (org config does not grant in tutorial)', async () => {
    await createGroup(groupInput('org-only', { memberIds: [viewerId] }), adminUser);
    try {
      expect((await resolveUserGroupGrants(viewerId, 'org')).length).toBe(1);
      expect(await resolveUserGroupGrants(viewerId, 'tutorial')).toEqual([]);
    } finally {
      await updateGroup('org-only', groupInput('org-only', { memberIds: [] }), adminUser);
      await deleteGroup('org-only', adminUser);
    }
  });

  it('a membership naming a group that is NOT in config is ignored gracefully', async () => {
    await UserDB.update(viewerId, { groups: ['ghost-group'] });
    try {
      expect(await resolveUserGroupGrants(viewerId, 'org')).toEqual([]);
      const p = await resolveAccessPredicateWithGroups(viewer);
      expect(checkAccess(financeDash, p, 'access')).toBe(false);
    } finally {
      await UserDB.update(viewerId, { groups: [] });
    }
  });

  it('guests never resolve group grants', async () => {
    const guest: EffectiveUser = { userId: 999999, email: 'g@x', name: 'G', role: 'viewer', home_folder: 'sales', mode: 'org', guest: { canChat: false, shareFileId: 1, nonce: 'n' } };
    const p = await resolveAccessPredicateWithGroups(guest);
    expect(p.grants.length).toBe(1);
  });
});

describe('config-stored groups — CRUD + guards', () => {
  it('create / list / update / delete round-trip (definitions live in config)', async () => {
    await createGroup(groupInput('team', { folders: ['marketing', 'sales'], memberIds: [viewerId] }), adminUser);
    const listed = (await listGroups('org')).find(g => g.name === 'team')!;
    expect([...listed.folders].sort()).toEqual(['marketing', 'sales']);
    expect(listed.memberIds).toEqual([viewerId]);

    await updateGroup('team', groupInput('team', { allowedTypes: ['question'], viewTypes: ['question'], folders: ['marketing'], memberIds: [] }), adminUser);
    const updated = (await listGroups('org')).find(g => g.name === 'team')!;
    expect(updated.folders).toEqual(['marketing']);
    expect(updated.allowedTypes).toEqual(['question']);
    expect(updated.memberIds).toEqual([]);

    await deleteGroup('team', adminUser);
    expect((await listGroups('org')).find(g => g.name === 'team')).toBeUndefined();
  });

  it('deleting a group still assigned to a user is refused; works after unassign', async () => {
    await createGroup(groupInput('sticky', { memberIds: [viewerId] }), adminUser);
    await expect(deleteGroup('sticky', adminUser)).rejects.toThrow(/still assigned|in use|member/i);
    await updateGroup('sticky', groupInput('sticky', { memberIds: [] }), adminUser);
    await deleteGroup('sticky', adminUser);
    expect((await listGroups('org')).find(g => g.name === 'sticky')).toBeUndefined();
  });

  it('reserved built-in names cannot be created; duplicates rejected', async () => {
    for (const name of ['admin', 'editor', 'viewer']) {
      await expect(createGroup(groupInput(name), adminUser)).rejects.toThrow(/built-in|reserved/i);
    }
    await createGroup(groupInput('dup'), adminUser);
    try {
      await expect(createGroup(groupInput('dup'), adminUser)).rejects.toThrow(/exists/i);
    } finally {
      await deleteGroup('dup', adminUser);
    }
  });

  it('membership round-trips through the users table (groups array)', async () => {
    await createGroup(groupInput('m1', { memberIds: [viewerId] }), adminUser);
    try {
      expect((await UserDB.getById(viewerId))?.groups).toEqual(['m1']);
      await updateGroup('m1', groupInput('m1', { memberIds: [] }), adminUser);
      expect((await UserDB.getById(viewerId))?.groups).toEqual([]);
    } finally {
      await deleteGroup('m1', adminUser).catch(() => {});
    }
  });
});

describe('group-aware read surfaces', () => {
  it('search returns group-granted files to a member; not to a non-member', async () => {
    await createGroup(groupInput('fin-search', { memberIds: [viewerId] }), adminUser);
    try {
      const res = await searchFilesInFolder({ query: 'report', folder_path: '/org', visibility: 'ui' }, viewer);
      expect(res.results.map(r => r.path)).toContain('/org/finance/report');
    } finally {
      await updateGroup('fin-search', groupInput('fin-search', { memberIds: [] }), adminUser);
      await deleteGroup('fin-search', adminUser);
    }
    const res2 = await searchFilesInFolder({ query: 'report', folder_path: '/org', visibility: 'ui' }, viewer);
    expect(res2.results.map(r => r.path)).not.toContain('/org/finance/report');
  });
});

describe('validation', () => {
  it('validateGroupsSection accepts valid sections, rejects junk + reserved names', () => {
    expect(validateGroupsSection({ team: { allowedTypes: '*', viewTypes: '*', createTypes: [], folders: ['x'] } })).toBeNull();
    expect(validateGroupsSection([])).toMatch(/object/);
    expect(validateGroupsSection({ admin: { allowedTypes: '*', viewTypes: '*', createTypes: '*', folders: [] } })).toMatch(/built-in/);
    expect(validateGroupsSection({ t: { allowedTypes: 5, viewTypes: '*', createTypes: '*', folders: [] } })).toMatch(/allowedTypes/);
    expect(validateGroupsSection({ t: { allowedTypes: '*', viewTypes: '*', createTypes: '*', folders: [1] } })).toMatch(/folders/);
  });

  it('validateGroupInput guards the API payload', () => {
    const ok = { name: 'Team', allowedTypes: ['question'], viewTypes: ['question'], createTypes: [], folders: ['finance'], memberIds: [1] };
    expect(validateGroupInput(ok)).toHaveProperty('input');
    expect(validateGroupInput({ ...ok, name: '' })).toHaveProperty('error');
    expect(validateGroupInput({ ...ok, name: 'admin' })).toHaveProperty('error');
    expect(validateGroupInput({ ...ok, allowedTypes: 5 })).toHaveProperty('error');
    expect(validateGroupInput({ ...ok, folders: [1] })).toHaveProperty('error');
    expect(validateGroupInput({ ...ok, memberIds: ['x'] })).toHaveProperty('error');
  });
});
