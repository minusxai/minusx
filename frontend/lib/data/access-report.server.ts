/**
 * Access V2 (M3) — explainability. Two admin-facing questions, answered from
 * the same primitives the enforcement engine uses:
 *  - `folderAccessReport(path)`   — WHO can see a folder, and via what.
 *  - `userAccessReport(userId)`   — WHY a user has the access they have.
 * Read-only aggregation over users + groups; no new permission semantics.
 */
import 'server-only';
import { UserDB } from '@/lib/database/user-db';
import { listGroups } from '@/lib/data/groups.server';
import type { Mode } from '@/lib/mode/mode-types';
import { resolveHomeFolderSync, resolvePath } from '@/lib/mode/path-resolver';

export interface FolderAccessEntry {
  kind: 'admin-role' | 'home-folder' | 'group';
  /** Group name for kind 'group'; otherwise a human label. */
  label: string;
  /** Write (create/edit/delete) vs view-only, for the path in question. */
  write: boolean;
  /** Member emails (for groups) or the user's email (home/admin). */
  users: string[];
}

/** Normalize a mode-relative or absolute folder to an absolute path. */
function toAbsolute(path: string, mode: Mode): string {
  const clean = path.replace(/\/+$/g, '');
  if (clean === '' || clean === '/') return `/${mode}`;
  if (clean.startsWith(`/${mode}`)) return clean;
  return resolvePath(mode, clean.startsWith('/') ? clean : `/${clean}`);
}

const covers = (prefix: string, path: string) => path === prefix || path.startsWith(prefix + '/');

/** Who can access `path` (folder or file), and how. */
export async function folderAccessReport(path: string, mode: Mode): Promise<FolderAccessEntry[]> {
  const abs = toAbsolute(path, mode);
  const [users, groups] = await Promise.all([UserDB.listAll(), listGroups(mode)]);
  const byId = new Map(users.map(u => [u.id, u]));
  const entries: FolderAccessEntry[] = [];

  const admins = users.filter(u => u.role === 'admin');
  if (admins.length > 0) {
    entries.push({ kind: 'admin-role', label: 'Admins (full access to the workspace)', write: true, users: admins.map(a => a.email) });
  }

  for (const u of users) {
    if (u.role === 'admin') continue;
    const home = resolveHomeFolderSync(mode, u.home_folder);
    if (covers(home, abs)) {
      entries.push({ kind: 'home-folder', label: `${u.email} — home folder`, write: u.role === 'editor', users: [u.email] });
    }
  }

  for (const g of groups) {
    const scopeCovers = g.scopes.some(s => covers(toAbsolute(s, mode), abs));
    if (!scopeCovers || g.memberIds.length === 0) continue;
    const write = g.createTypes === '*' || (Array.isArray(g.createTypes) && g.createTypes.length > 0);
    entries.push({
      kind: 'group',
      label: g.name,
      write,
      users: g.memberIds.map(id => byId.get(id)?.email ?? `user #${id}`),
    });
  }

  return entries;
}

export interface UserAccessEntry {
  source: 'role' | 'home-folder' | 'group';
  label: string;
  detail: string;
}

/** Why does this user have the access they have? */
export async function userAccessReport(userId: number, mode: Mode): Promise<UserAccessEntry[]> {
  const user = await UserDB.getById(userId);
  if (!user) return [];
  const entries: UserAccessEntry[] = [];

  entries.push({
    source: 'role',
    label: `Role: ${user.role}`,
    detail: user.role === 'admin'
      ? 'Full access to every file in the workspace, plus admin settings.'
      : `Sets which file types they can ${user.role === 'editor' ? 'view and build' : 'view'}.`,
  });
  if (user.role !== 'admin') {
    entries.push({
      source: 'home-folder',
      label: `Home folder: /${user.home_folder || ''}`,
      detail: 'Their personal space — full role capabilities apply here.',
    });
    const groups = (await listGroups(mode)).filter(g => g.memberIds.includes(userId));
    for (const g of groups) {
      const write = g.createTypes === '*' || (Array.isArray(g.createTypes) && g.createTypes.length > 0);
      entries.push({
        source: 'group',
        label: `Group: ${g.name}`,
        detail: `${write ? 'Can build' : 'Can view'} in ${g.scopes.map(s => `/${s}`).join(', ') || '(no folders)'}.`,
      });
    }
  }
  return entries;
}
