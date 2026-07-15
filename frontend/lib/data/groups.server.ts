/**
 * Access V2 (M2/M3) — groups data layer. A group is a capability profile
 * (`allowedTypes`/`viewTypes`/`createTypes`) applied over a set of folder
 * scopes, with a member list. `resolveUserGroupGrants` is what the access
 * resolver appends to the base (role) grant; the rest is CRUD for the admin UI.
 *
 * Groups aren't files, so this uses the low-level DB module directly (the same
 * primitive `DocumentDB` runs on).
 */
import 'server-only';
import { getModules } from '@/lib/modules/registry';
import type { Mode } from '@/lib/mode/mode-types';
import { resolvePath } from '@/lib/mode/path-resolver';
import type { AccessGrant, TypeSet } from '@/lib/auth/access-predicate';
import type { FileType } from '@/lib/types';

export interface Group {
  id: number;
  name: string;
  mode: Mode;
  kind: 'admin' | 'editor' | 'viewer' | 'custom';
  allowedTypes: TypeSet;
  viewTypes: TypeSet;
  createTypes: TypeSet;
  locked: boolean;
  /** Mode-relative folder prefixes ('' = mode root). */
  scopes: string[];
  memberIds: number[];
}

/** Normalize a stored JSONB capability into a `TypeSet` ('*' or FileType[]). */
function parseTypeSet(v: unknown): TypeSet {
  const val = typeof v === 'string' ? safeJson(v) : v;
  if (val === '*') return '*';
  return Array.isArray(val) ? (val as FileType[]) : [];
}
function safeJson(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
function toJson(set: TypeSet): string { return JSON.stringify(set); }

/** Resolve a folder ('' → mode root) to an absolute path scope. */
function scopePath(mode: Mode, folder: string): string {
  return folder ? resolvePath(mode, `/${folder.replace(/^\/+|\/+$/g, '')}`) : `/${mode}`;
}

/**
 * The group grants for a user in a mode — appended to the base grant by the
 * access resolver. Empty when the user is in no groups (the common case →
 * behavior stays role + home only).
 */
export async function resolveUserGroupGrants(userId: number, mode: Mode): Promise<AccessGrant[]> {
  const db = getModules().db;
  const res = await db.exec<{ id: number; allowed_types: unknown; folder: string | null }>(
    `SELECT g.id, g.allowed_types, s.folder
       FROM group_members m
       JOIN groups g ON g.id = m.group_id AND g.mode = $2
       LEFT JOIN group_scopes s ON s.group_id = g.id
      WHERE m.user_id = $1`,
    [userId, mode],
  );
  const byGroup = new Map<number, { allowedTypes: TypeSet; folders: string[] }>();
  for (const row of res.rows) {
    let g = byGroup.get(row.id);
    if (!g) { g = { allowedTypes: parseTypeSet(row.allowed_types), folders: [] }; byGroup.set(row.id, g); }
    if (row.folder != null) g.folders.push(row.folder);
  }
  return [...byGroup.values()]
    .filter(g => g.folders.length > 0) // a grant with no scope grants nothing
    .map(g => ({ allowedTypes: g.allowedTypes, scopes: g.folders.map(f => ({ path: scopePath(mode, f) })) }));
}

interface GroupRow {
  id: number; name: string; mode: string; kind: string;
  allowed_types: unknown; view_types: unknown; create_types: unknown; locked: boolean;
}

function rowToGroup(r: GroupRow, scopes: string[], memberIds: number[]): Group {
  return {
    id: r.id, name: r.name, mode: r.mode as Mode, kind: r.kind as Group['kind'],
    allowedTypes: parseTypeSet(r.allowed_types), viewTypes: parseTypeSet(r.view_types),
    createTypes: parseTypeSet(r.create_types), locked: r.locked, scopes, memberIds,
  };
}

export async function listGroups(mode: Mode): Promise<Group[]> {
  const db = getModules().db;
  const groups = await db.exec<GroupRow>('SELECT * FROM groups WHERE mode = $1 ORDER BY id', [mode]);
  if (groups.rows.length === 0) return [];
  const ids = groups.rows.map(g => g.id);
  const ph = ids.map((_, i) => `$${i + 1}`).join(',');
  const scopes = await db.exec<{ group_id: number; folder: string }>(`SELECT group_id, folder FROM group_scopes WHERE group_id IN (${ph})`, ids);
  const members = await db.exec<{ group_id: number; user_id: number }>(`SELECT group_id, user_id FROM group_members WHERE group_id IN (${ph})`, ids);
  return groups.rows.map(g => rowToGroup(
    g,
    scopes.rows.filter(s => s.group_id === g.id).map(s => s.folder),
    members.rows.filter(m => m.group_id === g.id).map(m => m.user_id),
  ));
}

export async function getGroup(id: number): Promise<Group | null> {
  const db = getModules().db;
  const g = await db.exec<GroupRow>('SELECT * FROM groups WHERE id = $1', [id]);
  if (g.rows.length === 0) return null;
  const scopes = await db.exec<{ folder: string }>('SELECT folder FROM group_scopes WHERE group_id = $1', [id]);
  const members = await db.exec<{ user_id: number }>('SELECT user_id FROM group_members WHERE group_id = $1', [id]);
  return rowToGroup(g.rows[0], scopes.rows.map(s => s.folder), members.rows.map(m => m.user_id));
}

export interface GroupInput {
  name: string;
  mode: Mode;
  kind?: Group['kind'];
  allowedTypes: TypeSet;
  viewTypes: TypeSet;
  createTypes: TypeSet;
  scopes: string[];
  memberIds: number[];
}

/** Validate an untrusted group payload into a `GroupInput` (or an error message). */
export function validateGroupInput(body: unknown, mode: Mode): { input: GroupInput } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.name !== 'string' || !b.name.trim()) return { error: 'Group name is required' };
  const asTypeSet = (v: unknown): TypeSet | null =>
    v === '*' ? '*' : Array.isArray(v) && v.every(x => typeof x === 'string') ? (v as FileType[]) : null;
  const allowedTypes = asTypeSet(b.allowedTypes);
  if (allowedTypes === null) return { error: 'allowedTypes must be "*" or an array of file types' };
  const viewTypes = asTypeSet(b.viewTypes ?? []);
  if (viewTypes === null) return { error: 'viewTypes must be "*" or an array of file types' };
  const createTypes = asTypeSet(b.createTypes ?? []);
  if (createTypes === null) return { error: 'createTypes must be "*" or an array of file types' };
  const scopes = Array.isArray(b.scopes) && b.scopes.every(s => typeof s === 'string') ? (b.scopes as string[]) : null;
  if (scopes === null) return { error: 'scopes must be an array of folder strings' };
  const memberIds = Array.isArray(b.memberIds) && b.memberIds.every(x => Number.isInteger(x)) ? (b.memberIds as number[]) : null;
  if (memberIds === null) return { error: 'memberIds must be an array of user ids' };
  return { input: { name: b.name.trim(), mode, allowedTypes, viewTypes, createTypes, scopes, memberIds } };
}

export async function createGroup(input: GroupInput): Promise<Group> {
  const db = getModules().db;
  const res = await db.exec<{ id: number }>(
    `INSERT INTO groups (name, mode, kind, allowed_types, view_types, create_types)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [input.name, input.mode, input.kind ?? 'custom', toJson(input.allowedTypes), toJson(input.viewTypes), toJson(input.createTypes)],
  );
  const id = res.rows[0].id;
  await replaceScopes(id, input.scopes);
  await replaceMembers(id, input.memberIds);
  return (await getGroup(id))!;
}

export async function updateGroup(id: number, input: GroupInput): Promise<Group> {
  const db = getModules().db;
  const existing = await getGroup(id);
  if (!existing) throw new Error(`Group ${id} not found`);
  if (existing.locked) throw new Error('This group is locked and cannot be edited');
  await db.exec(
    `UPDATE groups SET name=$1, allowed_types=$2, view_types=$3, create_types=$4, updated_at=CURRENT_TIMESTAMP WHERE id=$5`,
    [input.name, toJson(input.allowedTypes), toJson(input.viewTypes), toJson(input.createTypes), id],
  );
  await replaceScopes(id, input.scopes);
  await replaceMembers(id, input.memberIds);
  return (await getGroup(id))!;
}

export async function deleteGroup(id: number): Promise<void> {
  const db = getModules().db;
  const existing = await getGroup(id);
  if (existing?.locked) throw new Error('This group is locked and cannot be deleted');
  await db.exec('DELETE FROM groups WHERE id = $1', [id]); // scopes/members cascade
}

async function replaceScopes(groupId: number, folders: string[]): Promise<void> {
  const db = getModules().db;
  await db.exec('DELETE FROM group_scopes WHERE group_id = $1', [groupId]);
  for (const folder of [...new Set(folders.map(f => f.replace(/^\/+|\/+$/g, '')))]) {
    await db.exec('INSERT INTO group_scopes (group_id, folder) VALUES ($1,$2)', [groupId, folder]);
  }
}

async function replaceMembers(groupId: number, userIds: number[]): Promise<void> {
  const db = getModules().db;
  await db.exec('DELETE FROM group_members WHERE group_id = $1', [groupId]);
  for (const userId of [...new Set(userIds)]) {
    await db.exec('INSERT INTO group_members (group_id, user_id) VALUES ($1,$2)', [groupId, userId]);
  }
}
