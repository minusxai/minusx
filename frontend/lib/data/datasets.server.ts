import 'server-only';

/**
 * Datasets data layer — resolution + naming for static-data-as-files.
 *
 * Lives in lib/data (direct DocumentDB access) for two load-bearing reasons:
 *  - UNIQUENESS must be checked against EVERY dataset in the mode, including
 *    ones the caller's ACL hides — a per-user FilesAPI listing would silently
 *    miss collisions and corrupt the global-name invariant.
 *  - RESOLUTION enforces its own two-part authorization (below), independent
 *    of the file ACL, because `filePath` on /api/query is client-supplied.
 *
 * A dataset at folder F resolves for user U querying from folder L iff:
 *  1. F is ancestor-or-self of L      (visibility flows down, never up/sideways)
 *  2. U may read F: admin, or F is on U's home-folder ancestor chain, or F is
 *     inside U's home  (so borrowing another team's filePath yields their
 *     ancestors' org-wide data at most — never that team's own datasets)
 */

import { DocumentDB } from '@/lib/database/documents-db';
import { resolvePath, resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { isAdmin } from '@/lib/auth/role-helpers';
import { exposedTables, tableKey } from '@/lib/types/datasets';
import type { DatasetContent, DatasetTable, ResolvedDataset } from '@/lib/types/datasets';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

export class DatasetNameConflictError extends Error {
  constructor(key: string) {
    // Deliberately does NOT say where the taken name lives — the owning folder
    // may be invisible to the caller (same disclosure rule as _views names).
    super(`static table '${key}' already exists — choose another table or schema name`);
    this.name = 'DatasetNameConflictError';
  }
}

const isAncestorOrSelf = (folder: string, target: string): boolean =>
  target === folder || target.startsWith(folder + '/');

const folderOf = (path: string): string => path.substring(0, path.lastIndexOf('/')) || '/';

/** May `user` read datasets homed at `folder`? (rule 2 above) */
function userMayReadFolder(user: EffectiveUser, folder: string): boolean {
  if (isAdmin(user.role)) return true;
  const home = resolveHomeFolderSync(user.mode, user.home_folder);
  return isAncestorOrSelf(folder, home) || isAncestorOrSelf(home, folder);
}

/** Every dataset doc in the user's mode (unfiltered — internal). */
async function listAllDatasets(mode: string): Promise<Array<{ id: number; path: string; content: DatasetContent }>> {
  const modePath = resolvePath(mode as EffectiveUser['mode'], '/');
  const docs = await DocumentDB.listAll('dataset', [modePath]);
  return docs.map((d) => ({ id: d.id, path: d.path, content: d.content as DatasetContent }));
}

/** Datasets visible to `user` when querying from `folderPath` (both rules). */
export async function getVisibleDatasets(folderPath: string, user: EffectiveUser): Promise<ResolvedDataset[]> {
  const all = await listAllDatasets(user.mode);
  return all
    .map((d) => ({ fileId: d.id, folder: folderOf(d.path), content: d.content }))
    .filter((d) => isAncestorOrSelf(d.folder, folderPath) && userMayReadFolder(user, d.folder));
}

/** The exposed tables visible from `folderPath` — what the query surface sees. */
export async function getVisibleTables(folderPath: string, user: EffectiveUser): Promise<DatasetTable[]> {
  const datasets = await getVisibleDatasets(folderPath, user);
  return datasets.flatMap((d) => exposedTables(d.content));
}

/**
 * Enforce global `schema.table` uniqueness per mode for a batch of tables about
 * to be created/kept on one dataset. Checks the batch against itself and
 * against EVERY other dataset (hidden tables included — hiding is exposure,
 * not deletion, so the name stays held). `excludeFileId` skips the dataset
 * being edited so it never collides with itself.
 */
export async function assertTableNamesAvailable(
  tables: Array<Pick<DatasetTable, 'schema_name' | 'table_name'>>,
  user: EffectiveUser,
  opts: { excludeFileId?: number } = {},
): Promise<void> {
  const batch = new Set<string>();
  for (const t of tables) {
    const key = tableKey(t);
    if (batch.has(key)) throw new DatasetNameConflictError(key);
    batch.add(key);
  }

  const all = await listAllDatasets(user.mode);
  const taken = new Set<string>();
  for (const d of all) {
    if (d.id === opts.excludeFileId) continue;
    for (const t of d.content.files ?? []) taken.add(tableKey(t));
  }
  for (const key of batch) {
    if (taken.has(key)) throw new DatasetNameConflictError(key);
  }
}
