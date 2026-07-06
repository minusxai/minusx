/**
 * File mutation operations that are neither "read" nor "edit-in-place":
 * delete, move (single/batch), reload, discard, draft creation, duplication,
 * dry-run save validation, and folder creation.
 */

import { getStore } from '@/store/store';
import { selectFile, deleteFile as deleteFileAction, setFileInfo, setLoading, setFile, clearEdits, clearMetadataEdits, clearEphemeral, selectDirtyFiles, persistableContentOf, selectIsDirty, addFile, type FileState } from '@/store/filesSlice';
import { FilesAPI } from '@/lib/data/files';
import { CACHE_TTL } from '@/lib/constants/cache';
import { extractReferencesFromContent } from '@/lib/data/helpers/extract-references';
import { resolveHomeFolderSync, isFileTypeAllowedInPath, getDefaultFolderForType } from '@/lib/mode/path-resolver';
import { fetchWithCache } from '@/lib/http/fetch-wrapper';
import { API } from '@/lib/http/declarations';
import type { FileType, DbFile } from '@/lib/types';
import type { DryRunSaveResult } from '@/lib/data/types';
import { readFolder, loadFiles } from '@/lib/file-state/file-read';

/**
 * Options for deleteFile
 */
export interface DeleteFileOptions {
  fileId: number;
}

/**
 * DeleteFile - Delete a file from database and Redux
 *
 * Handles deletion of files including folders (recursive delete on server).
 * Removes file from Redux on success.
 *
 * @param options - File ID to delete
 */
export async function deleteFile(options: DeleteFileOptions): Promise<void> {
  const { fileId } = options;

  // Call API to delete file
  await FilesAPI.deleteFile(fileId);

  // Remove from Redux
  const state = getStore().getState();
  const file = selectFile(state, fileId);
  if (file) {
    getStore().dispatch(deleteFileAction({ id: fileId, path: file.path }));
  }
}

/**
 * MoveFile - Update a file's name/path and sync Redux + affected parent folders
 *
 * On success:
 * - Updates the file's metadata in Redux via setFileInfo
 * - Force-reloads the old parent folder (removes file from its listing)
 * - Force-reloads the new parent folder (adds file to its listing)
 */
export async function moveFile(fileId: number, name: string, newPath: string): Promise<void> {
  const data = await FilesAPI.moveFile({ id: fileId, name, newPath });
  const { oldPath } = data;

  // Update the file's metadata in Redux
  const state = getStore().getState();
  const file = selectFile(state, fileId);
  if (file) {
    getStore().dispatch(setFileInfo([{
      ...file,
      name,
      path: newPath,
      references: file.references ?? [],
    }]));
  }

  // Reload only the two affected parent folders
  const oldParent = oldPath.split('/').slice(0, -1).join('/') || '/';
  const newParent = newPath.split('/').slice(0, -1).join('/') || '/';
  const parentsToReload = new Set([oldParent, newParent]);
  await Promise.all([...parentsToReload].map(p => readFolder(p, { forceLoad: true })));

  // For folder moves, also reload the moved folder itself so children get fresh paths
  const movedFile = selectFile(getStore().getState(), fileId);
  if (movedFile?.type === 'folder') {
    await readFolder(newPath, { forceLoad: true });
  }
}

/**
 * Move multiple files to a destination folder in a single API call.
 */
export async function batchMoveFiles(files: Array<{ id: number; name: string }>, destFolder: string): Promise<void> {
  const results = await FilesAPI.batchMoveFiles(
    files.map(f => ({ id: f.id, name: f.name, newPath: `${destFolder}/${f.name}` }))
  );

  // Batch-update Redux state for all moved files
  const state = getStore().getState();
  const fileInfoUpdates = results
    .map(r => {
      const file = selectFile(state, r.id);
      if (!file) return null;
      return { ...file, name: r.name, path: r.path, references: file.references ?? [] };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);

  if (fileInfoUpdates.length > 0) {
    getStore().dispatch(setFileInfo(fileInfoUpdates));
  }

  // Reload all affected parent folders
  const parentsToReload = new Set<string>();
  for (const r of results) {
    const oldParent = r.oldPath.split('/').slice(0, -1).join('/') || '/';
    const newParent = r.path.split('/').slice(0, -1).join('/') || '/';
    parentsToReload.add(oldParent);
    parentsToReload.add(newParent);
  }
  await Promise.all([...parentsToReload].map(p => readFolder(p, { forceLoad: true })));

  // Reload any moved folders so their children get fresh paths
  for (const r of results) {
    const movedFile = selectFile(getStore().getState(), r.id);
    if (movedFile?.type === 'folder') {
      await readFolder(r.path, { forceLoad: true });
    }
  }
}

/**
 * Options for reloadFile
 */
export interface ReloadFileOptions {
  fileId: number;
  silent?: boolean;  // Skip loading state
}

/**
 * ReloadFile - Force refresh a file from database
 *
 * Bypasses TTL cache and fetches fresh data.
 * Overwrites any local changes.
 *
 * @param options - File ID and options
 */
export async function reloadFile(options: ReloadFileOptions): Promise<void> {
  const { fileId, silent = false } = options;

  // Skip reloading virtual files (negative IDs)
  // Virtual files only exist in Redux and have no database representation
  if (fileId < 0) {
    console.warn(`[reloadFile] Skipping reload of virtual file ${fileId} - virtual files cannot be reloaded from database`);
    return;
  }

  // Set loading state (unless silent)
  if (!silent) {
    getStore().dispatch(setLoading({ id: fileId, loading: true }));
  }

  try {
    // Force fetch from API (with undefined user parameter)
    const result = await FilesAPI.loadFile(fileId, undefined, { refresh: true });

    // Update Redux with fresh data. reloadFile is the explicit discard/force-reload path — its
    // documented contract is to OVERWRITE local changes, so opt out of edit preservation.
    getStore().dispatch(setFile({
      file: result.data,
      references: result.metadata.references || [],
      analytics: result.metadata.analytics,
      conversationAnalytics: result.metadata.conversationAnalytics,
      overwriteEdits: true,
    }));
  } finally {
    // Clear loading state
    if (!silent) {
        getStore().dispatch(setLoading({ id: fileId, loading: false }));
    }
  }
}

/**
 * Options for clearFileChanges
 */
export interface ClearFileChangesOptions {
  fileId: number;
}

/**
 * ClearFileChanges - Discard local changes without reloading
 *
 * Clears persistableChanges, metadataChanges, and ephemeralChanges.
 * File reverts to original state from database.
 *
 * @param options - File ID
 */
export function clearFileChanges(options: ClearFileChangesOptions): void {
  const { fileId } = options;

  // Import clear actions

  // Clear all changes
  getStore().dispatch(clearEdits(fileId));
  getStore().dispatch(clearMetadataEdits(fileId));
  getStore().dispatch(clearEphemeral(fileId));
}

/**
 * discardAll - Discard changes for dirty non-system files.
 *
 * Real files (id >= 0): clears persistableChanges, metadataChanges, ephemeralChanges.
 * Virtual files (id < 0): removed from Redux entirely.
 * Real files are cleared first so dashboard refs to virtual IDs revert before the virtual files are removed.
 *
 * @param fileIds - Optional list of file IDs to scope the discard to.
 *   When provided, only these files (+ their dirty dependencies) are discarded.
 *   When omitted, all dirty non-system files are discarded.
 */
export function discardAll(fileIds?: number[]): void {
  const state = getStore().getState();
  const allDirtyUnscoped = selectDirtyFiles(state);
  let filesToDiscard: FileState[];
  if (fileIds) {
    const scopedIds = new Set(fileIds);
    // Expand: look at ALL scoped files (not just dirty) to find their dirty children.
    // E.g., a clean dashboard references a dirty question — the question should be discarded.
    for (const id of [...scopedIds]) {
      const f = state.files.files[id];
      if (!f) continue;
      const merged = persistableContentOf(f) ?? {};
      const refs = extractReferencesFromContent(merged as any, f.type as FileType);
      for (const refId of refs) {
        if (selectIsDirty(state, refId)) scopedIds.add(refId);
      }
    }
    filesToDiscard = allDirtyUnscoped.filter(f => scopedIds.has(f.id));
  } else {
    filesToDiscard = allDirtyUnscoped;
  }

  for (const file of filesToDiscard) {
    getStore().dispatch(clearEdits(file.id));
    getStore().dispatch(clearMetadataEdits(file.id));
    getStore().dispatch(clearEphemeral(file.id));
  }
}

// ============================================================================
// Create Virtual File
// ============================================================================

// ============================================================================
// Create Draft File
// ============================================================================

/**
 * Options for creating a draft file (server-side)
 */
export interface CreateDraftFileOptions {
  /** Folder path override (defaults to user's home_folder) */
  folder?: string;
  /** For questions: pre-populate with this database/connection name */
  databaseName?: string;
  /** For questions: pre-populate with this SQL query */
  query?: string;
  /** Name for the file — uses a slug to set the DB path immediately so parent folders are navigable */
  name?: string;
}

/**
 * createDraftFile - Create a new file on the server immediately with draft:true.
 *
 * Unlike createVirtualFile (which uses a negative client-side ID), this calls the
 * server right away and gets back a real positive ID. The file is stored in the DB
 * with draft:true, making it invisible in folder listings until first real save.
 *
 * @param type - The type of file to create (question, dashboard, etc.)
 * @param options - Optional configuration (folder, connection, query)
 * @returns Real file ID (positive number) — consistent from creation to publish
 */
export async function createDraftFile(
  type: FileType,
  options: CreateDraftFileOptions = {}
): Promise<number> {
  const { folder, databaseName, query, name } = options;

  const state = getStore().getState();
  const user = state.auth.user;

  let resolvedFolder = folder;
  if (!resolvedFolder) {
    resolvedFolder = user
      ? resolveHomeFolderSync(user.mode, user.home_folder || '')
      : '/org';
  }

  const mode = user?.mode || 'org';
  if (!isFileTypeAllowedInPath(type, resolvedFolder, mode)) {
    const originalFolder = resolvedFolder;
    resolvedFolder = getDefaultFolderForType(type, mode);
    console.log(`[createDraftFile] Redirected ${type} from restricted folder:`, {
      originalFolder,
      redirectedFolder: resolvedFolder
    });
  }

  const template = await FilesAPI.getTemplate(type, {
    path: resolvedFolder,
    databaseName,
    query
  });

  const baseFolder = resolvedFolder.replace(/\/+$/, '');
  let fileName: string;
  let filePath: string;
  if (name) {
    // Slug the name immediately so the DB path is correct from creation.
    // Important for folders that will be used as parents within the same session.
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    fileName = name;
    filePath = `${baseFolder}/${slug}`;
  } else if (template.fileName) {
    fileName = template.fileName;
    filePath = `${baseFolder}/${template.fileName}`;
  } else {
    // Template has no name (questions, dashboards, etc.) — name stays empty,
    // path uses a random token to guarantee uniqueness in the DB.
    const token = Math.random().toString(36).slice(2, 10);
    fileName = '';
    filePath = `${baseFolder}/${token}`;
  }

  const result = await FilesAPI.createFile({
    name: fileName,
    path: filePath,
    type,
    content: template.content,
    references: [],
  });

  const file = result.data;
  getStore().dispatch(setFile({ file, references: [] }));
  return file.id;
}


/**
 * duplicateFile - Create a copy of an existing file in the same folder.
 *
 * Loads the source file's saved content, then creates a new file with the same
 * type/content/references and a name suffixed with " [duplicate]". The path uses
 * a slug + random token to guarantee uniqueness in the DB.
 *
 * @param fileId - The file to duplicate.
 * @returns The new file's id.
 */
export async function duplicateFile(fileId: number): Promise<number> {
  // Ensure the source file's content is loaded (the list view may be partial).
  await loadFiles([fileId], CACHE_TTL.FILE, false);

  const state = getStore().getState();
  const source = selectFile(state, fileId);
  if (!source) {
    throw new Error(`File ${fileId} not found`);
  }
  if (source.type === 'folder') {
    throw new Error('Cannot duplicate a folder');
  }

  const content = source.content;
  const type = source.type as FileType;

  // Same folder as the source.
  const folder = source.path.substring(0, source.path.lastIndexOf('/')) || '/org';
  const baseFolder = folder.replace(/\/+$/, '');

  const newName = source.name ? `${source.name} [duplicate]` : '';
  const slugBase = (source.name || 'copy').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'copy';
  const token = Math.random().toString(36).slice(2, 10);
  const newPath = `${baseFolder}/${slugBase}-${token}`;

  const references = extractReferencesFromContent(content as any, type);

  const result = await FilesAPI.createFile({
    name: newName,
    path: newPath,
    type,
    content: content as any,
    references,
  });

  // createFile creates user-content types as a draft (draft = true), which the
  // server excludes from folder listings — so the copy would vanish on reload.
  // Publish it immediately via saveFile (sets draft = false) so it persists.
  const created = result.data;
  const published = await FilesAPI.saveFile(
    created.id,
    created.name,
    created.path,
    content as any,
    references,
    undefined,
    undefined,
    created.version
  );

  const file = published.data;
  // addFile (not setFile) so the new file surfaces in its parent folder's
  // child list — the list view reads folder children from the parent's refs.
  getStore().dispatch(addFile(file));
  return file.id;
}


// ============================================================================
// Dry Run Save
// ============================================================================

/**
 * dryRunSave - Validate a batch save without committing to the database.
 *
 * Collects all dirty files (optionally scoped by fileIds) and runs batchSaveFiles
 * with dryRun:true — the server wraps everything in a transaction that always rolls
 * back. Useful for pre-flight checks that catch cross-file path conflicts before
 * the user actually commits.
 *
 * @param fileIds - Optional list of file IDs to scope the dry run to.
 *   When omitted, all dirty non-system files are included.
 * @returns DryRunSaveResult — success:true if all saves would succeed, or errors list.
 */
export async function dryRunSave(fileIds?: number[]): Promise<DryRunSaveResult> {
  const state = getStore().getState();
  const allDirtyUnscoped = selectDirtyFiles(state);
  const allDirty = fileIds
    ? allDirtyUnscoped.filter(f => fileIds.includes(f.id))
    : allDirtyUnscoped;

  if (allDirty.length === 0) return { success: true, errors: [] };

  const toSave = allDirty.map(f => {
    const merged = persistableContentOf(f) ?? {};
    return {
      id: f.id,
      name: f.metadataChanges?.name || f.name,
      path: f.metadataChanges?.path || f.path,
      content: merged,
      references: extractReferencesFromContent(merged as any, f.type as FileType),
    };
  });

  return FilesAPI.batchSaveFiles(toSave as any, undefined, true);
}

// ============================================================================
// Create Folder
// ============================================================================

/**
 * Result of folder creation
 */
export interface CreateFolderResult {
  id: number;
  name: string;
  path: string;
}

/**
 * createFolder - Create a new folder in the file system
 *
 * @param folderName - Name of the new folder
 * @param parentPath - Parent path where folder will be created
 * @returns Folder metadata (id, name, path)
 *
 * Example:
 * ```typescript
 * const folder = await createFolder('Sales Reports', '/org');
 * // Creates folder at /org/Sales Reports
 * console.log(folder.path); // "/org/sales-reports"
 * ```
 */
export async function createFolder(
  folderName: string,
  parentPath: string
): Promise<CreateFolderResult> {
  // Call API to create folder

  const result = await fetchWithCache('/api/folders', {
    method: 'POST',
    body: JSON.stringify({ folderName, parentPath }),
    cacheStrategy: API.folders.create.cache,
  });

  // Construct folder file object
  const now = new Date().toISOString();
  const folderFile: DbFile = {
    id: result.data.id,
    name: result.data.name,
    path: result.data.path,
    type: 'folder',
    references: [],  // Folder references computed dynamically from children
    content: { description: '' },
    created_at: now,
    updated_at: now,
    version: 1,
    last_edit_id: null,
  };

  // Add to Redux
  getStore().dispatch(addFile(folderFile));

  // Return metadata
  return {
    id: result.data.id,
    name: result.data.name,
    path: result.data.path
  };
}
