import { createSlice, PayloadAction, createSelector } from '@reduxjs/toolkit';
import type { DbFile, FileType, DocumentContent, AssetReference, QuestionContent, QuestionReference } from '@/lib/types';
import type { FileInfo } from '@/lib/data/types';
import type { RootState } from './store';
import { getQueryHash } from '@/lib/utils/query-hash';
import type { LoadError } from '@/lib/types/errors';
import { replaceNegativeIdsInContent } from '@/lib/data/helpers/replace-references';

// System file types that save in-place and are excluded from bulk Publish.
// Defined as a Set here (instead of importing from file-metadata) to avoid
// circular-dependency issues between store and ui modules.
const SYSTEM_FILE_TYPES_SET = new Set<string>(['connection', 'config', 'styles', 'context']);

/**
 * Ephemeral changes - non-persistent state like lastExecuted query
 */
export type EphemeralChanges = Partial<DbFile['content']> & {
  lastExecuted?: {
    query: string;
    params: Record<string, any>;
    database: string;
    references: any[];
  };
  parameterValues?: Record<string, any>;  // Ephemeral runtime param overrides (not persisted)
};

/**
 * FileState: Complete file state including metadata and change tracking
 * Extends DbFile with UI state and change tracking
 * Implements Core Patterns architecture from Phase 1
 */
export interface FileState extends DbFile {
  // Computed references (IDs of referenced files from content.assets)
  references: number[];

  // UI state tracking
  loading: boolean;
  saving: boolean;    // Phase 2: Track save operations
  updatedAt: number;  // Timestamp of last fetch (for TTL checks)
  loadError: LoadError | null;  // Error from last load attempt

  // Change tracking (Phase 2)
  persistableChanges: Partial<DbFile['content']>;
  ephemeralChanges: EphemeralChanges;
  metadataChanges: { name?: string; path?: string }; // Phase 5: Metadata edits
}

/**
 * FileId type - always a number
 * Virtual IDs (for create mode) are negative numbers: -1, -2, -3, etc.
 * Real file IDs are positive numbers: 1, 2, 3, etc.
 */
export type FileId = number;

/**
 * Check if a file ID is a virtual file ID (for create mode)
 * Virtual files have negative IDs (< 0)
 */
export function isVirtualFileId(id: FileId | undefined): boolean {
  return typeof id === 'number' && id < 0;
}

/**
 * Get the next available virtual file ID
 * Finds the smallest (most negative) existing virtual ID and decrements it
 * If no virtual IDs exist, returns -1
 */
export function getNextVirtualFileId(files: Record<FileId, FileState>): FileId {
  const virtualIds = Object.keys(files)
    .map(Number)
    .filter(id => id < 0);

  if (virtualIds.length === 0) {
    return -1;
  }

  const minId = Math.min(...virtualIds);
  return minId - 1;
}

// djb2-style hash — stays within 32-bit range
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/**
 * Generate a virtual ID for a new user-created file (namespace 1)
 * ID is always 10 digits: -(1_000_000_000 + Date.now() % 1_000_000_000)
 */
export function generateVirtualId(): number {
  return -(1_000_000_000 + (Date.now() % 1_000_000_000));
}

/**
 * Deterministic virtual ID for a path-loading placeholder (namespace 2)
 * ID is always 10 digits: -(2_000_000_000 + |hash(path)| % 1_000_000_000)
 */
export function pathToVirtualId(path: string): number {
  return -(2_000_000_000 + (Math.abs(hashString(path)) % 1_000_000_000));
}

/**
 * Redux state structure for files
 */
interface FilesState {
  files: Record<FileId, FileState>;
  pathIndex: Record<string, number>;  // path → file ID mapping (only for real files)
}

const initialState: FilesState = {
  files: {},
  pathIndex: {}
};

const filesSlice = createSlice({
  name: 'files',
  initialState,
  reducers: {
    /**
     * Set a single file in Redux
     * Used by useFile hook after loading file + references
     */
    setFile(state, action: PayloadAction<{
      file: DbFile;
      references?: DbFile[];
    }>) {
      const { file, references = [] } = action.payload;

      // Extract references from content
      const referenceIds = extractReferences(file);

      // Store the main file
      state.files[file.id] = {
        ...file,
        references: referenceIds,
        loading: false,
        saving: false,
        updatedAt: Date.now(),
        loadError: null,
        persistableChanges: {},
        ephemeralChanges: {},
        metadataChanges: {}
      };

      // Update path index (only for real files with positive IDs)
      // Cleanup: remove path-placeholder when real file arrives
      if (file.id > 0) {
        const oldId = state.pathIndex[file.path];
        if (oldId !== undefined && oldId < 0) {
          delete state.files[oldId];
        }
        state.pathIndex[file.path] = file.id;
      }

      // Store all referenced files
      references.forEach(ref => {
        const refReferenceIds = extractReferences(ref);
        state.files[ref.id] = {
          ...ref,
          references: refReferenceIds,
          loading: false,
          saving: false,
          updatedAt: Date.now(),
          loadError: null,
          persistableChanges: {},
          ephemeralChanges: {},
          metadataChanges: {}
        };

        // Update path index for references
        state.pathIndex[ref.path] = ref.id;
      });
    },

    /**
     * Set multiple files in Redux
     * Used by loadFiles API
     */
    setFiles(state, action: PayloadAction<{
      files: DbFile[];
      references?: DbFile[];
    }>) {
      const { files, references = [] } = action.payload;

      // Store all main files
      files.forEach(file => {
        const referenceIds = extractReferences(file);
        state.files[file.id] = {
          ...file,
          references: referenceIds,
          loading: false,
          saving: false,
          updatedAt: Date.now(),
          loadError: null,
          persistableChanges: {},
          ephemeralChanges: {},
          metadataChanges: {}
        };

        // Update path index
        state.pathIndex[file.path] = file.id;
      });

      // Store all referenced files
      references.forEach(ref => {
        const refReferenceIds = extractReferences(ref);
        state.files[ref.id] = {
          ...ref,
          references: refReferenceIds,
          loading: false,
          saving: false,
          updatedAt: Date.now(),
          loadError: null,
          persistableChanges: {},
          ephemeralChanges: {},
          metadataChanges: {}
        };

        // Update path index for references
        state.pathIndex[ref.path] = ref.id;
      });
    },

    /**
     * Set FileInfo (metadata without full content)
     * Used by useFolder hook for folder listings
     */
    setFileInfo(state, action: PayloadAction<FileInfo[]>) {
      action.payload.forEach(fileInfo => {
        // If file already exists, update metadata only
        if (state.files[fileInfo.id]) {
          state.files[fileInfo.id] = {
            ...state.files[fileInfo.id],
            name: fileInfo.name,
            path: fileInfo.path,
            type: fileInfo.type,
            references: fileInfo.references,
            created_at: fileInfo.created_at,
            updated_at: fileInfo.updated_at,
            updatedAt: Date.now()
          };
        } else {
          // Create partial file state (content: null = not loaded)
          state.files[fileInfo.id] = {
            ...fileInfo,
            content: null,  // Metadata-only - not loaded yet
            loading: false,
            saving: false,
            updatedAt: Date.now(),
            loadError: null,
            persistableChanges: {},
            ephemeralChanges: {},
            metadataChanges: {}
          };
        }

        // Update path index
        state.pathIndex[fileInfo.path] = fileInfo.id;
      });
    },

    /**
     * Set loading state for a file
     */
    setLoading(state, action: PayloadAction<{ id: FileId; loading: boolean }>) {
      const { id, loading } = action.payload;
      if (state.files[id]) {
        state.files[id].loading = loading;
        if (loading) state.files[id].loadError = null;  // Clear error on new fetch
      } else {
        // Create placeholder state with loading flag
        state.files[id] = {
          id: id as any,  // Allow both number and string IDs
          name: '',
          path: '',
          type: 'question',
          references: [],
          content: {} as any,
          created_at: '',
          updated_at: '',
          company_id: 0,  // Placeholder value
          loading,
          saving: false,
          updatedAt: 0,
          loadError: null,
          persistableChanges: {},
          ephemeralChanges: {},
          metadataChanges: {}
        };
      }
    },

    /**
     * Create a loading placeholder for a file being fetched by path.
     * Uses a deterministic namespace-2 virtual ID derived from the path.
     * No-ops if a real (positive-ID) file is already indexed at that path.
     */
    setFilePlaceholder(state, action: PayloadAction<string>) {
      const path = action.payload;
      // Don't overwrite a real (positive-ID) file already at this path
      const existingId = state.pathIndex[path];
      if (existingId !== undefined && existingId > 0) return;

      const placeholderId = pathToVirtualId(path);
      state.files[placeholderId] = {
        id: placeholderId,
        name: '',
        path,
        type: 'folder',  // stand-in type — same pattern as setFolderLoading
        references: [],
        content: null,
        created_at: '',
        updated_at: '',
        company_id: 0,
        loading: true,
        saving: false,
        updatedAt: 0,
        loadError: null,
        persistableChanges: {},
        ephemeralChanges: {},
        metadataChanges: {}
      };
      state.pathIndex[path] = placeholderId;
    },

    /**
     * Set loading state for a folder by path
     * Creates a placeholder entry for unseen folders (when loading=true)
     */
    setFolderLoading(state, action: PayloadAction<{ path: string; loading: boolean }>) {
      const { path, loading } = action.payload;
      const folderId = state.pathIndex[path];

      if (folderId && state.files[folderId]) {
        state.files[folderId].loading = loading;
        if (loading) state.files[folderId].loadError = null;  // clear on retry
      } else if (loading) {
        // Create a placeholder for an unseen folder (same pattern as setFolderInfo)
        const syntheticId = -(Object.keys(state.files).length + 1);
        const folderName = path.split('/').pop() || path;
        state.files[syntheticId] = {
          id: syntheticId,
          name: folderName,
          path,
          type: 'folder',
          references: [],
          content: null,
          created_at: '',
          updated_at: '',
          company_id: 0,
          loading: true,
          saving: false,
          updatedAt: 0,
          loadError: null,
          persistableChanges: {},
          ephemeralChanges: {},
          metadataChanges: {}
        };
        state.pathIndex[path] = syntheticId;
      }
    },

    /**
     * Track edits (Phase 2 - currently unused)
     * Merge with existing persistableChanges
     */
    setEdit(state, action: PayloadAction<{ fileId: FileId; edits: Partial<DbFile['content']> }>) {
      const { fileId, edits } = action.payload;
      if (state.files[fileId]) {
        // Merge edits with existing persistableChanges
        const newPersistableChanges = {
          ...state.files[fileId].persistableChanges,
          ...edits
        };

        // For questions: recompute queryResultId if query/params/database changed
        if (state.files[fileId].type === 'question' && edits) {
          const questionEditsKeys = ['query', 'parameters', 'database_name'];
          const hasQueryChanges = Object.keys(edits).some(key => questionEditsKeys.includes(key));

          if (hasQueryChanges) {
            // Merge current content with all changes to get complete picture
            const mergedContent = {
              ...state.files[fileId].content,
              ...newPersistableChanges
            } as QuestionContent;

            const params = (mergedContent.parameters || []).reduce((acc, p) => {
              acc[p.name] = p.defaultValue ?? '';
              return acc;
            }, {} as Record<string, any>);

            const queryResultId = getQueryHash(mergedContent.query, params, mergedContent.database_name);
            (newPersistableChanges as any).queryResultId = queryResultId;
          }
        }

        state.files[fileId].persistableChanges = newPersistableChanges;
      }
    },

    /**
     * Replace entire content (not merge)
     * Used by JSON editors where the full content is provided
     */
    setFullContent(state, action: PayloadAction<{ fileId: FileId; content: DbFile['content'] }>) {
      const { fileId, content } = action.payload;
      if (state.files[fileId]) {
        let contentToStore = content;

        // For questions: compute and add queryResultId
        if (state.files[fileId].type === 'question' && content) {
          const questionContent = content as QuestionContent;
          const params = (questionContent.parameters || []).reduce((acc, p) => {
            acc[p.name] = p.defaultValue ?? '';
            return acc;
          }, {} as Record<string, any>);
          const queryResultId = getQueryHash(questionContent.query, params, questionContent.database_name);
          contentToStore = { ...content, queryResultId } as DbFile['content'];
        }

        // Store the full new content as persistableChanges
        // On save, this replaces file.content entirely
        state.files[fileId].persistableChanges = contentToStore;
      }
    },

    /**
     * Clear edits after save (Phase 2)
     */
    clearEdits(state, action: PayloadAction<FileId>) {
      if (state.files[action.payload]) {
        state.files[action.payload].persistableChanges = {};
      }
    },

    /**
     * Set ephemeral changes (Phase 3)
     * Used for non-persistent state like lastExecuted query
     * Merge with existing ephemeralChanges
     */
    setEphemeral(state, action: PayloadAction<{ fileId: FileId; changes: EphemeralChanges }>) {
      const { fileId, changes } = action.payload;
      if (state.files[fileId]) {
        state.files[fileId].ephemeralChanges = {
          ...state.files[fileId].ephemeralChanges,
          ...changes
        };
      }
    },

    /**
     * Clear ephemeral changes (Phase 3)
     */
    clearEphemeral(state, action: PayloadAction<FileId>) {
      if (state.files[action.payload]) {
        state.files[action.payload].ephemeralChanges = {};
      }
    },

    /**
     * Set metadata changes (Phase 5)
     * Used for editing file name/path before save
     * Merge with existing metadataChanges
     */
    setMetadataEdit(state, action: PayloadAction<{ fileId: FileId; changes: { name?: string; path?: string } }>) {
      const { fileId, changes } = action.payload;
      const file = state.files[fileId];
      if (!file) return;

      // Auto-update path slug when name changes (keep parent folder)
      let updatedChanges = { ...changes };
      if (changes.name && !changes.path) {
        // Get current path (with any pending changes applied)
        const currentPath = file.metadataChanges?.path || file.path;

        // Extract parent folder (everything before last /)
        const parentFolder = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/org';

        // Generate new slug from name
        const newSlug = changes.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');

        // Combine parent + slug
        updatedChanges.path = `${parentFolder}/${newSlug}`;
      }

      file.metadataChanges = {
        ...file.metadataChanges,
        ...updatedChanges
      };
    },

    /**
     * Clear metadata changes after save or cancel (Phase 5)
     */
    clearMetadataEdits(state, action: PayloadAction<FileId>) {
      if (state.files[action.payload]) {
        state.files[action.payload].metadataChanges = {};
      }
    },

    /**
     * Set saving state for a file (Phase 2)
     */
    setSaving(state, action: PayloadAction<{ id: FileId; saving: boolean }>) {
      const { id, saving } = action.payload;
      if (state.files[id]) {
        state.files[id].saving = saving;
      }
    },

    /**
     * Update file content from API response after save (Phase 2)
     * Updates content and metadata without changing UI state
     */
    updateFileContent(state, action: PayloadAction<{ id: FileId; file: DbFile }>) {
      const { id, file } = action.payload;
      if (state.files[id]) {
        // Update content and metadata from API response
        state.files[id].content = file.content;
        state.files[id].name = file.name;
        state.files[id].path = file.path;
        state.files[id].updated_at = file.updated_at;
        state.files[id].updatedAt = Date.now();
      }
    },

    /**
     * Clear all files (for cleanup)
     */
    clearFiles(state) {
      state.files = {};
      state.pathIndex = {};
    },

    /**
     * Set folder info with child file IDs
     * Creates folder entry if it doesn't exist (for virtual folders)
     */
    setFolderInfo(state, action: PayloadAction<{
      path: string;
      fileInfos: FileInfo[];
    }>) {
      const { path, fileInfos } = action.payload;

      // Get child file IDs
      const childIds = fileInfos.map(f => f.id);

      // Get or create folder file ID
      let folderId = state.pathIndex[path];

      if (!folderId || !state.files[folderId]) {
        // Create synthetic folder entry for virtual folders
        // Use negative IDs to avoid conflicts with real DB IDs
        const syntheticId = -(Object.keys(state.files).length + 1);
        folderId = syntheticId;

        const folderName = path.split('/').pop() || path;
        state.files[folderId] = {
          id: folderId,
          name: folderName,
          path: path,
          type: 'folder',
          references: childIds,
          content: { description: '' },  // Empty folder content (name is in file metadata)
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          company_id: 0,  // Synthetic folder placeholder
          loading: false,
          saving: false,
          updatedAt: Date.now(),
          loadError: null,
          persistableChanges: {},
          ephemeralChanges: {},
          metadataChanges: {}
        };

        state.pathIndex[path] = folderId;
      } else {
        // Update existing folder file with children and mark as loaded
        state.files[folderId].references = childIds;
        // Ensure folder has content (mark as loaded) - folders have trivial content
        state.files[folderId].content = state.files[folderId].content || { description: '' };
        state.files[folderId].updatedAt = Date.now();
        state.files[folderId].loading = false;
      }

      // Store all child files (metadata-only, content will be null)
      fileInfos.forEach(fileInfo => {
        if (state.files[fileInfo.id]) {
          // Update existing file metadata (don't overwrite content if already loaded)
          state.files[fileInfo.id] = {
            ...state.files[fileInfo.id],
            name: fileInfo.name,
            path: fileInfo.path,
            type: fileInfo.type,
            references: fileInfo.references,
            created_at: fileInfo.created_at,
            updated_at: fileInfo.updated_at,
            updatedAt: Date.now()
          };
        } else {
          // Create new file entry (content: null = not loaded)
          state.files[fileInfo.id] = {
            ...fileInfo,
            content: null,  // Metadata-only - not loaded yet
            loading: false,
            saving: false,
            updatedAt: Date.now(),
            loadError: null,
            persistableChanges: {},
            ephemeralChanges: {},
            metadataChanges: {}
          };
        }

        // Update path index
        state.pathIndex[fileInfo.path] = fileInfo.id;
      });
    },

    /**
     * Delete a file from Redux cache
     * Removes the file and updates any folders that reference it
     */
    deleteFile(state, action: PayloadAction<{ id: FileId; path: string }>) {
      const { id, path } = action.payload;

      // Remove the file
      delete state.files[id];
      delete state.pathIndex[path];

      // Get parent folder path
      const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
      const parentFolderId = state.pathIndex[parentPath];

      // Update parent folder to remove this file from references
      if (parentFolderId && state.files[parentFolderId]) {
        state.files[parentFolderId].references = state.files[parentFolderId].references.filter(
          refId => refId !== id
        );
        // Update parent folder's timestamp to invalidate cache
        state.files[parentFolderId].updatedAt = Date.now();
      }

      // If deleted file was a folder, also remove all children
      Object.keys(state.files).forEach(key => {
        const fileId = Number(key);
        const file = state.files[fileId];
        if (file && file.path.startsWith(path + '/')) {
          delete state.files[fileId];
          delete state.pathIndex[file.path];
        }
      });
    },

    /**
     * Add a new file/folder to Redux cache
     * Updates parent folder to include the new file in references
     */
    addFile(state, action: PayloadAction<DbFile>) {
      const file = action.payload;
      const referenceIds = extractReferences(file);

      // Add the new file
      state.files[file.id] = {
        ...file,
        references: referenceIds,
        loading: false,
        saving: false,
        updatedAt: Date.now(),
        loadError: null,
        persistableChanges: {},
        ephemeralChanges: {},
        metadataChanges: {}
      };

      // Update path index (guard against undefined path)
      if (file.path) {
        state.pathIndex[file.path] = file.id;

        // Get parent folder path
        const parentPath = file.path.substring(0, file.path.lastIndexOf('/')) || '/';
        const parentFolderId = state.pathIndex[parentPath];

        // Update parent folder to add this file to references
        if (parentFolderId && state.files[parentFolderId]) {
          // Add to references if not already there
          if (!state.files[parentFolderId].references.includes(file.id)) {
            state.files[parentFolderId].references.push(file.id);
          }
          // Update parent folder's timestamp to invalidate cache
          state.files[parentFolderId].updatedAt = Date.now();
        }
      }
    },

    /**
     * Set load error for one or more files
     * Also clears loading state for all affected files
     */
    setLoadError(state, action: PayloadAction<{ ids: FileId[]; error: LoadError }>) {
      const { ids, error } = action.payload;
      ids.forEach(id => {
        if (state.files[id]) {
          state.files[id].loadError = error;
          state.files[id].loading = false;
        }
      });
    },

    /**
     * Add a question to a dashboard
     * Encapsulates the logic for adding questions to dashboards:
     * - Check if question already exists
     * - Calculate grid position (bottom of layout)
     * - Update assets and layout in persistableChanges
     */
    addQuestionToDashboard(state, action: PayloadAction<{ dashboardId: number; questionId: number }>) {
      const { dashboardId, questionId } = action.payload;
      const dashboard = state.files[dashboardId];
      if (!dashboard || dashboard.type !== 'dashboard') return;

      // Get merged content (content + persistableChanges)
      const content = dashboard.content as DocumentContent | null;
      const changes = dashboard.persistableChanges as Partial<DocumentContent> | undefined;
      if (!content) return;

      // Get current assets (from changes if available, otherwise from content)
      const currentAssets = changes?.assets ?? content.assets ?? [];
      const currentLayout = changes?.layout ?? content.layout ?? { columns: 12, items: [] };

      // Check if question already exists
      const questionIds = currentAssets
        .filter((a: AssetReference) => a.type === 'question' && 'id' in a)
        .map((a: AssetReference) => (a as { type: 'question'; id: number }).id);

      if (questionIds.includes(questionId)) {
        return; // Already exists
      }

      // Find position for new question (bottom of grid)
      const maxY = currentLayout.items?.reduce((max: number, item: any) => {
        return Math.max(max, (item.y ?? 0) + (item.h ?? 4));
      }, 0) ?? 0;

      // Add new asset
      const newAsset: AssetReference = {
        type: 'question',
        id: questionId
      };

      // Add new layout item with default size (w:6, h:4)
      const newLayoutItem = {
        id: questionId.toString(),
        x: 0,
        y: maxY,
        w: 6,
        h: 4,
      };

      // Update persistableChanges
      state.files[dashboardId].persistableChanges = {
        ...changes,
        assets: [...currentAssets, newAsset],
        layout: {
          columns: 12,
          items: [...(currentLayout.items || []), newLayoutItem]
        }
      };
    },

    /**
     * Add a reference to a question (composed questions)
     * - Check for duplicates (by id and alias)
     * - Single-level only enforced at UI level
     */
    addReferenceToQuestion(state, action: PayloadAction<{
      questionId: number;
      referencedQuestionId: number;
      alias: string;
    }>) {
      const { questionId, referencedQuestionId, alias } = action.payload;
      const question = state.files[questionId];
      if (!question || question.type !== 'question') return;

      const content = question.content as QuestionContent;
      const changes = question.persistableChanges as Partial<QuestionContent> | undefined;
      const currentRefs = changes?.references ?? content.references ?? [];

      // Prevent duplicates (by ID or alias)
      if (currentRefs.some((ref: QuestionReference) => ref.id === referencedQuestionId || ref.alias === alias)) {
        return;
      }

      // Add new reference
      state.files[questionId].persistableChanges = {
        ...changes,
        references: [...currentRefs, { id: referencedQuestionId, alias }]
      };
    },

    /**
     * Remove a reference from a question
     */
    removeReferenceFromQuestion(state, action: PayloadAction<{
      questionId: number;
      referencedQuestionId: number;
    }>) {
      const { questionId, referencedQuestionId } = action.payload;
      const question = state.files[questionId];
      if (!question || question.type !== 'question') return;

      const content = question.content as QuestionContent;
      const changes = question.persistableChanges as Partial<QuestionContent> | undefined;
      const currentRefs = changes?.references ?? content.references ?? [];

      state.files[questionId].persistableChanges = {
        ...changes,
        references: currentRefs.filter((ref: QuestionReference) => ref.id !== referencedQuestionId)
      };
    },

    /**
     * Atomically replace virtual (negative) IDs with real (positive) IDs across
     * all dirty real files in Redux.
     *
     * Called by publishAll() after batch-creating virtual files — rewrites any
     * negative-ID references in persistableChanges so the subsequent batch-save
     * persists correct real IDs to the database.
     *
     * @param idMap - mapping of { virtualId: realId }
     */
    replaceVirtualIds(state, action: PayloadAction<Record<number, number>>) {
      const idMap = action.payload;
      if (Object.keys(idMap).length === 0) return;

      for (const fileIdStr of Object.keys(state.files)) {
        const fileId = Number(fileIdStr);
        const file = state.files[fileId];

        // Skip virtual files themselves and files with no pending changes
        if (!file || fileId < 0) continue;
        if (!file.persistableChanges || Object.keys(file.persistableChanges).length === 0) continue;

        // Merge base content + pending changes, then rewrite any negative IDs
        const merged = { ...file.content, ...file.persistableChanges } as any;
        const updated = replaceNegativeIdsInContent(merged, file.type as FileType, idMap);

        if (JSON.stringify(updated) !== JSON.stringify(merged)) {
          state.files[fileId].persistableChanges = {
            ...file.persistableChanges,
            ...updated
          };
        }
      }
    }
  }
});

/**
 * Helper: Extract reference IDs from file content
 */
function extractReferences(file: DbFile): number[] {
  // Dashboards, presentations, notebooks use content.assets
  if (file.type === 'dashboard' || file.type === 'presentation' || file.type === 'notebook') {
    const content = file.content as any;
    return content.assets
      ?.filter((a: any) => a.type === 'question')
      ?.map((a: any) => a.id)
      .filter((id: any): id is number => typeof id === 'number') || [];
  }

  // Reports use content.references with nested reference.id
  if (file.type === 'report') {
    const content = file.content as any;
    return content.references
      ?.map((r: any) => r.reference?.id)
      .filter((id: any): id is number => typeof id === 'number') || [];
  }

  // Handle question references
  if (file.type === 'question') {
    const content = file.content as QuestionContent;
    return content.references?.map((ref: QuestionReference) => ref.id) || [];
  }

  return [];
}

// Actions
export const {
  setFile,
  setFiles,
  setFileInfo,
  setLoading,
  setFilePlaceholder,
  setFolderLoading,
  setLoadError,
  setEdit,
  setFullContent,
  clearEdits,
  setEphemeral,
  clearEphemeral,
  setMetadataEdit,
  clearMetadataEdits,
  setSaving,
  updateFileContent,
  clearFiles,
  setFolderInfo,
  deleteFile,
  addFile,
  addQuestionToDashboard,
  addReferenceToQuestion,
  removeReferenceFromQuestion,
  replaceVirtualIds
} = filesSlice.actions;

// Selectors
/**
 * Get a file by ID (returns undefined if not loaded)
 */
export const selectFile = (state: RootState, id: FileId): FileState | undefined => {
  return state.files.files[id];
};

/**
 * Get multiple files by IDs
 */
export const selectFiles = createSelector(
  [
    (state: RootState) => state.files.files,
    (_state: RootState, ids: FileId[]) => ids
  ],
  (files, ids): FileState[] => {
    return ids.map(id => files[id]).filter(Boolean);
  }
);

/**
 * Check if file is loaded (has content)
 */
export const selectIsFileLoaded = (state: RootState, id: FileId): boolean => {
  const file = state.files.files[id];
  // File is loaded if it exists and has content (even if content is empty object like folders)
  if (!file || !file.content) return false;
  // Check if content exists and is not just a placeholder
  return Object.keys(file.content).length > 0;
};

/**
 * Check if file is fresh (within TTL)
 */
export const selectIsFileFresh = (state: RootState, id: FileId, ttl: number = 60000): boolean => {
  const file = state.files.files[id];
  if (!file || !selectIsFileLoaded(state, id)) return false;
  return Date.now() - file.updatedAt < ttl;
};

/**
 * Get merged content (content + persistableChanges + ephemeralChanges)
 * Phase 2: Will be used for edit mode rendering
 * Memoized to prevent unnecessary re-renders
 */
export const selectMergedContent = createSelector(
  [
    (state: RootState, id: FileId) => state.files.files[id]?.content,
    (state: RootState, id: FileId) => state.files.files[id]?.persistableChanges,
    (state: RootState, id: FileId) => state.files.files[id]?.ephemeralChanges
  ],
  (content, persistableChanges, ephemeralChanges): DbFile['content'] | undefined => {
    if (!content) return undefined;

    // Only create new object if there are changes to merge
    if (!persistableChanges && !ephemeralChanges) {
      return content;
    }

    // Merge: content <- persistableChanges <- ephemeralChanges
    return {
      ...content,
      ...persistableChanges,
      ...ephemeralChanges
    } as DbFile['content'];
  }
);

/**
 * Get file ID by path (returns undefined if not found)
 */
export const selectFileIdByPath = (state: RootState, path: string): number | undefined => {
  return state.files.pathIndex[path];
};

/**
 * Check if folder is loaded (content is not null)
 * Simple check: content === null means not loaded (metadata-only)
 */
export const selectIsFolderLoaded = (state: RootState, path: string): boolean => {
  const folderId = state.files.pathIndex[path];
  if (!folderId) return false;

  const folder = state.files.files[folderId];
  if (!folder) return false;

  // Folder is loaded if content is not null
  return folder.content !== null;
};

/**
 * Check if folder is fresh (within TTL)
 */
export const selectIsFolderFresh = (state: RootState, path: string, ttl: number = 60000): boolean => {
  if (!selectIsFolderLoaded(state, path)) return false;

  const folderId = state.files.pathIndex[path];
  const folder = state.files.files[folderId!];

  return Date.now() - folder.updatedAt < ttl;
};

/**
 * Check if file has unsaved changes (Phase 2 + Phase 5)
 * Checks both content changes and metadata changes
 */
export const selectIsDirty = (state: RootState, id: FileId): boolean => {
  const file = state.files.files[id];
  if (!file) return false;

  const hasContentChanges = file.persistableChanges && Object.keys(file.persistableChanges).length > 0;
  const hasMetadataChanges = file.metadataChanges && (file.metadataChanges.name !== undefined || file.metadataChanges.path !== undefined);

  return hasContentChanges || hasMetadataChanges;
};

/**
 * Get effective file name (with pending metadata changes) (Phase 5)
 */
export const selectEffectiveName = (state: RootState, id: FileId): string | undefined => {
  const file = state.files.files[id];
  if (!file) return undefined;
  return file.metadataChanges.name ?? file.name;
};

/**
 * Get effective file path (with pending metadata changes) (Phase 5)
 */
export const selectEffectivePath = (state: RootState, id: FileId): string | undefined => {
  const file = state.files.files[id];
  if (!file) return undefined;
  return file.metadataChanges.path ?? file.path;
};

/**
 * Check if file has unsaved metadata changes (Phase 5)
 */
export const selectHasMetadataChanges = (state: RootState, id: FileId): boolean => {
  const file = state.files.files[id];
  if (!file) return false;
  return file.metadataChanges.name !== undefined || file.metadataChanges.path !== undefined;
};

/**
 * Get load error for a file (returns null if no error)
 */
export const selectFileLoadError = (state: RootState, id: FileId): LoadError | null => {
  return state.files.files[id]?.loadError ?? null;
};

/**
 * Returns all loaded NON-system files that have unsaved changes.
 * System files (connection, config, styles, context) are excluded:
 * they save in-place and are discarded on navigation-away anyway.
 */
export const selectDirtyFiles = (state: RootState): FileState[] => {
  return Object.values(state.files.files).filter(file =>
    file &&
    !SYSTEM_FILE_TYPES_SET.has(file.type) &&
    (
      (file.persistableChanges && Object.keys(file.persistableChanges).length > 0) ||
      (file.metadataChanges && (file.metadataChanges.name !== undefined || file.metadataChanges.path !== undefined))
    )
  ) as FileState[];
};

// ============================================================================
// BACKWARDS COMPATIBILITY: Connection selectors
// ============================================================================
// These maintain the same API as old connectionsSlice for gradual migration

import type { DatabaseSchema } from '@/lib/types';

export interface ConnectionWithSchema {
  metadata: {
    name: string;
    type: 'duckdb' | 'bigquery' | 'postgresql' | 'csv' | 'google-sheets';
    config: Record<string, any>;
    created_at: string;
    updated_at: string;
  };
  schema: DatabaseSchema | null;
  schemaLoadedAt: number;
  schemaError?: string;
}

/**
 * Find context file for a given path
 * Returns deepest matching context or undefined
 */
export const selectContextFromPath = createSelector(
  [
    (state: RootState) => state.files.files,
    (_state: RootState, path: string) => path
  ],
  (files, path): FileState | undefined => {
    // Get all context files
    const contextFiles = Object.values(files).filter(f => f.type === 'context') as FileState[];

    // Normalize path (remove trailing slash for consistent matching)
    const normalizedPath = path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path;

    // Find matching contexts - ancestors and same directory
    const matchingContexts = contextFiles.filter(ctx => {
      const contextDir = ctx.path.substring(0, ctx.path.lastIndexOf('/')) || '/';

      if (contextDir === '/') {
        return normalizedPath.startsWith('/') && normalizedPath !== '/';
      } else {
        // Match if path is within contextDir OR equals contextDir (for folder views)
        return normalizedPath.startsWith(contextDir + '/') || normalizedPath === contextDir;
      }
    });

    // Sort by depth (deepest first = nearest ancestor)
    const sortedContexts = matchingContexts.sort((a, b) => {
      const depthA = (a.path.match(/\//g) || []).length;
      const depthB = (b.path.match(/\//g) || []).length;
      return depthB - depthA;
    });

    return sortedContexts[0];
  }
);

/**
 * Get ephemeral parameter values for a file
 * Used by question/dashboard views to get runtime param overrides
 */
export const selectEphemeralParamValues = (state: RootState, id: FileId): Record<string, any> => {
  return (state.files.files[id]?.ephemeralChanges as EphemeralChanges)?.parameterValues || {};
};

export default filesSlice.reducer;
