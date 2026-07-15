/**
 * Access V2 — groups data layer, CONFIG-STORED (no tables).
 *
 * A group's DEFINITION (capabilities × folders) lives in the org config
 * document's `groups` section — same home as `accessRules`, hand-editable,
 * versioned with the config. MEMBERSHIP is the `groups` array of names on the
 * users table. The built-in groups (admin/editor/viewer) are the `role`
 * column + `rules.json`; custom groups are purely additive on top.
 *
 * `resolveUserGroupGrants` is what the access resolver appends to the base
 * grant; the rest is CRUD for the admin UI. Names are immutable (no rename);
 * a group still assigned to users cannot be deleted.
 */
import 'server-only';
import type { Mode } from '@/lib/mode/mode-types';
import { resolvePath } from '@/lib/mode/path-resolver';
import type { AccessGrant, TypeSet } from '@/lib/auth/access-predicate';
import type { FileType } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { GroupDef } from '@/lib/branding/whitelabel';
import { getRawConfig, saveRawConfig } from '@/lib/data/configs.server';
import { validateGroupsSection } from '@/lib/validation/config-validators';
import { UserDB } from '@/lib/database/user-db';

export const BUILTIN_GROUPS = ['admin', 'editor', 'viewer'] as const;

export interface Group extends GroupDef {
  name: string;
  memberIds: number[];
}

/** Resolve a folder ('' → mode root) to an absolute path scope. */
function scopePath(mode: Mode, folder: string): string {
  const clean = folder.replace(/^\/+|\/+$/g, '');
  return clean ? resolvePath(mode, `/${clean}`) : `/${mode}`;
}

/** The `groups` section of a mode's config document ({} when absent/invalid). */
async function readGroupDefs(mode: Mode): Promise<Record<string, GroupDef>> {
  const raw = await getRawConfig(mode);
  const groups = (raw as { groups?: unknown }).groups;
  if (!groups || validateGroupsSection(groups) !== null) return {};
  return groups as Record<string, GroupDef>;
}

/**
 * The custom-group grants for a user in a mode — appended to the base (role +
 * home) grant by the access resolver. Membership names that don't exist in the
 * mode's config are ignored (e.g. a group defined only in another mode).
 * Empty for users with no memberships — the common case — and for principals
 * without a user row (guests).
 */
export async function resolveUserGroupGrants(userId: number, mode: Mode): Promise<AccessGrant[]> {
  const user = await UserDB.getById(userId);
  if (!user || user.groups.length === 0) return [];
  const defs = await readGroupDefs(mode);
  const grants: AccessGrant[] = [];
  for (const name of user.groups) {
    const def = defs[name];
    if (!def || def.folders.length === 0) continue; // dangling name or no scope → grants nothing
    grants.push({
      allowedTypes: def.allowedTypes,
      createTypes: def.createTypes,
      scopes: def.folders.map(f => ({ path: scopePath(mode, f) })),
    });
  }
  return grants;
}

/** All custom groups in a mode, with membership resolved from the users table. */
export async function listGroups(mode: Mode): Promise<Group[]> {
  const [defs, users] = await Promise.all([readGroupDefs(mode), UserDB.listAll()]);
  return Object.entries(defs).map(([name, def]) => ({
    name,
    ...def,
    memberIds: users.filter(u => u.groups.includes(name)).map(u => u.id),
  }));
}

export async function getGroup(name: string, mode: Mode): Promise<Group | null> {
  return (await listGroups(mode)).find(g => g.name === name) ?? null;
}

export interface GroupInput {
  name: string;
  allowedTypes: TypeSet;
  viewTypes: TypeSet;
  createTypes: TypeSet;
  folders: string[];
  memberIds: number[];
}

/** Validate an untrusted group payload into a `GroupInput` (or an error message). */
export function validateGroupInput(body: unknown): { input: GroupInput } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.name !== 'string' || !b.name.trim()) return { error: 'Group name is required' };
  const name = b.name.trim();
  if ((BUILTIN_GROUPS as readonly string[]).includes(name)) {
    return { error: `"${name}" is a built-in group and cannot be redefined` };
  }
  const asTypeSet = (v: unknown): TypeSet | null =>
    v === '*' ? '*' : Array.isArray(v) && v.every(x => typeof x === 'string') ? (v as FileType[]) : null;
  const allowedTypes = asTypeSet(b.allowedTypes);
  if (allowedTypes === null) return { error: 'allowedTypes must be "*" or an array of file types' };
  const viewTypes = asTypeSet(b.viewTypes ?? []);
  if (viewTypes === null) return { error: 'viewTypes must be "*" or an array of file types' };
  const createTypes = asTypeSet(b.createTypes ?? []);
  if (createTypes === null) return { error: 'createTypes must be "*" or an array of file types' };
  const folders = Array.isArray(b.folders) && b.folders.every(f => typeof f === 'string') ? (b.folders as string[]) : null;
  if (folders === null) return { error: 'folders must be an array of folder strings' };
  const memberIds = Array.isArray(b.memberIds) && b.memberIds.every(x => Number.isInteger(x)) ? (b.memberIds as number[]) : null;
  if (memberIds === null) return { error: 'memberIds must be an array of user ids' };
  return { input: { name, allowedTypes, viewTypes, createTypes, folders, memberIds } };
}

function toDef(input: GroupInput): GroupDef {
  return {
    allowedTypes: input.allowedTypes,
    viewTypes: input.viewTypes,
    createTypes: input.createTypes,
    folders: [...new Set(input.folders.map(f => f.replace(/^\/+|\/+$/g, '')))],
  };
}

/** Write the full groups section back into the mode's config document. */
async function writeGroupDefs(user: EffectiveUser, defs: Record<string, GroupDef>): Promise<void> {
  const raw = await getRawConfig(user.mode);
  await saveRawConfig(user.mode, { ...raw, groups: defs });
}

export async function createGroup(input: GroupInput, user: EffectiveUser): Promise<Group> {
  if ((BUILTIN_GROUPS as readonly string[]).includes(input.name)) {
    throw new Error(`"${input.name}" is a built-in group and cannot be redefined`);
  }
  const defs = await readGroupDefs(user.mode);
  if (defs[input.name]) throw new Error(`Group "${input.name}" already exists`);
  await writeGroupDefs(user, { ...defs, [input.name]: toDef(input) });
  await setMembers(input.name, input.memberIds);
  return (await getGroup(input.name, user.mode))!;
}

export async function updateGroup(name: string, input: GroupInput, user: EffectiveUser): Promise<Group> {
  const defs = await readGroupDefs(user.mode);
  if (!defs[name]) throw new Error(`Group "${name}" not found`);
  // Names are immutable — the definition is replaced under the SAME name.
  await writeGroupDefs(user, { ...defs, [name]: toDef({ ...input, name }) });
  await setMembers(name, input.memberIds);
  return (await getGroup(name, user.mode))!;
}

/** Delete a group definition. Refused while any user is still assigned to it. */
export async function deleteGroup(name: string, user: EffectiveUser): Promise<void> {
  const defs = await readGroupDefs(user.mode);
  if (!defs[name]) return;
  const members = (await UserDB.listAll()).filter(u => u.groups.includes(name));
  if (members.length > 0) {
    throw new Error(`Group "${name}" is still assigned to ${members.length} user(s) — remove the members first`);
  }
  const { [name]: _removed, ...rest } = defs;
  await writeGroupDefs(user, rest);
}

/** Reconcile the users table so exactly `memberIds` carry this group name. */
async function setMembers(name: string, memberIds: number[]): Promise<void> {
  const want = new Set(memberIds);
  for (const u of await UserDB.listAll()) {
    const has = u.groups.includes(name);
    if (want.has(u.id) && !has) {
      await UserDB.update(u.id, { groups: [...u.groups, name] });
    } else if (!want.has(u.id) && has) {
      await UserDB.update(u.id, { groups: u.groups.filter(g => g !== name) });
    }
  }
}
