/**
 * Publish operations — persist staged in-memory changes (persistableChanges /
 * metadataChanges) to the database.
 *
 * - publishFile: save one dirty file (handles optimistic-concurrency conflicts)
 * - publishAll: batch-publish all dirty non-system files in one round trip
 */

import { getStore } from '@/store/store';
import { selectFile, selectIsDirty, persistableContentOf, setSaving, setFile, clearEdits, clearMetadataEdits, selectDirtyFiles, type FileState } from '@/store/filesSlice';
import { ConflictError, FilesAPI } from '@/lib/data/files';
import { extractReferencesFromContent } from '@/lib/data/helpers/extract-references';
import type { FileType, DbFile } from '@/lib/types';
import { hashString } from '@/lib/file-state/shared';

/**
 * Options for publishFile
 */
export interface PublishFileOptions {
  fileId: number;
}

/**
 * Result from publishFile
 */
export interface PublishFileResult {
  id: number;
  name: string;
}

/**
 * PublishFile - Save file and dirty references to database
 *
 * Handles both virtual files (negative IDs) and real files (positive IDs).
 * Clears persistableChanges and metadataChanges on success.
 *
 * @param options - File ID to publish
 * @returns File ID and name for redirect logic
 */
export async function publishFile(
  options: PublishFileOptions
): Promise<PublishFileResult> {
  const { fileId } = options;
  const state = getStore().getState();

  // Get file state
  const fileState = selectFile(state, fileId);
  if (!fileState) {
    throw new Error(`File ${fileId} not found`);
  }

  // Import isDirty selector

  // Check if file is dirty
  const isDirty = selectIsDirty(state, fileId);
  if (!isDirty) {
    // Nothing to save, return current ID and name
    return { id: fileId, name: fileState.name };
  }

  // Prepare content for saving: merge only persistable changes, NOT ephemeral.
  // Ephemeral changes (lastExecuted, parameterValues, etc.) should not be persisted.
  // When contentReplaced is set (JSON-view edits via setFullContent), the
  // persistableChanges ARE the full content — no merge, so deletions persist.
  const contentToSave = persistableContentOf(fileState);

  if (!contentToSave) {
    throw new Error(`File ${fileId} has no content to save`);
  }

  const fileData = {
    name: fileState.metadataChanges?.name || fileState.name,
    path: fileState.metadataChanges?.path || fileState.path,
    type: fileState.type,
    content: contentToSave,
  };

  const references = extractReferencesFromContent(fileData.content, fileData.type as FileType);
  const editId = String(hashString(`${fileId}:${JSON.stringify(fileState.persistableChanges ?? {})}`));

  getStore().dispatch(setSaving({ id: fileId, saving: true }));

  let savedId: number;
  let savedName: string;
  let updatedFile: DbFile;

  try {
    const saveVersion = fileState.version;
    const saveContent = fileData.content;
    try {
      const result = await FilesAPI.saveFile(
        fileId,
        fileData.name,
        fileData.path,
        saveContent,
        references,
        undefined,
        editId,
        saveVersion
      );
      savedId = result.data.id;
      savedName = result.data.name;
      updatedFile = result.data;
    } catch (firstError) {
      if (!(firstError instanceof ConflictError)) throw firstError;
      // 409: server has a newer version. The conflict can be a content edit
      // OR a move (which now bumps version). Either way, take the server's
      // latest name/path on retry — we'd rather lose a local rename than
      // silently re-write a stale path. Overlay only the user's content edits
      // (persistableChanges) on top of the server's latest content.
      const serverFile = firstError.currentFile;
      getStore().dispatch(setFile({ file: serverFile }));
      const retryContent = (fileState.contentReplaced
        ? fileState.persistableChanges
        : { ...serverFile.content, ...fileState.persistableChanges }) as typeof saveContent;
      const result = await FilesAPI.saveFile(
        fileId,
        serverFile.name,
        serverFile.path,
        retryContent,
        references,
        undefined,
        editId,
        serverFile.version
      );
      savedId = result.data.id;
      savedName = result.data.name;
      updatedFile = result.data;
    }
  } catch (error) {
    if (error instanceof ConflictError) {
      getStore().dispatch(setFile({ file: error.currentFile }));
    }
    throw error;
  } finally {
    getStore().dispatch(setSaving({ id: fileId, saving: false }));
  }

  getStore().dispatch(setFile({ file: updatedFile! }));
  getStore().dispatch(clearEdits(fileId));
  getStore().dispatch(clearMetadataEdits(fileId));

  return { id: savedId!, name: savedName! };
}

/**
 * publishAll - Batch-publish all dirty non-system files in a single round trip.
 *
 * All files are expected to have real positive IDs (use createDraftFile to create
 * new files — they get real IDs from the server immediately, with draft:true).
 *
 * @param fileIds - Optional list of file IDs to scope the publish to.
 *   When provided, only these files (and their dirty dependencies) are saved.
 *   When omitted, all dirty non-system files are saved.
 *
 * Returns an empty map (no virtual→real ID mapping needed anymore).
 * Throws on error; caller is responsible for showing error state.
 */
export async function publishAll(fileIds?: number[]): Promise<Record<number, number>> {
  const state = getStore().getState();
  const allDirtyUnscoped = selectDirtyFiles(state);
  let allDirty: FileState[];
  if (fileIds) {
    // Start with explicitly requested files, then expand to include their dirty dependencies.
    const scopedIds = new Set(fileIds);
    for (const id of [...scopedIds]) {
      const f = state.files.files[id];
      if (!f) continue;
      const merged = persistableContentOf(f) ?? {};
      const refs = extractReferencesFromContent(merged as any, f.type as FileType);
      for (const refId of refs) {
        if (selectIsDirty(state, refId)) scopedIds.add(refId);
      }
    }
    allDirty = allDirtyUnscoped.filter(f => scopedIds.has(f.id));
  } else {
    allDirty = allDirtyUnscoped;
  }
  if (allDirty.length === 0) return {};

  const toSave = allDirty.map(f => {
    const merged = persistableContentOf(f) ?? {};
    return {
      id: f.id,
      name: f.metadataChanges?.name || f.name,
      path: f.metadataChanges?.path || f.path,
      content: merged,
      references: extractReferencesFromContent(merged as any, f.type as FileType),
      // Optimistic-concurrency guard: if any other tab moved or edited this
      // file in the meantime, the server's version no longer matches and we
      // get a conflict instead of silently re-writing stale metadata.
      expectedVersion: f.version,
    };
  });

  const { data: saved, conflicts = [] } = await FilesAPI.batchSaveFiles(toSave as any);
  for (const file of saved) {
    getStore().dispatch(setFile({ file }));
    getStore().dispatch(clearEdits(file.id));
    getStore().dispatch(clearMetadataEdits(file.id));
  }

  // Resolve conflicts per-file via publishFile. We do NOT dispatch setFile for
  // c.currentFile here — that would wipe the user's persistableChanges from
  // Redux. Instead let publishFile re-attempt with the (stale) expectedVersion;
  // the server will return ConflictError; publishFile's own catch path then
  // captures persistableChanges locally before dispatching setFile, overlays
  // them on serverFile.content, and retries against serverFile.name/path.
  for (const c of conflicts) {
    void c; // currentFile re-fetched implicitly via publishFile's retry path
    await publishFile({ fileId: c.id });
  }

  return {};
}
