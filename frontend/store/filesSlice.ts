import { createSlice, PayloadAction, createSelector, weakMapMemoize } from '@reduxjs/toolkit';
import type { DbFile, FileType, DocumentContent, AssetReference, QuestionContent, QuestionReference, DatabaseSchema } from '@/lib/types';
import type { FileInfo } from '@/lib/data/types';
import type { FileAnalyticsSummary, ConversationAnalyticsSummary } from '@/lib/analytics/file-analytics.types';
import type { RootState } from './store';
import type { LoadError } from '@/lib/types/errors';
import { extractReferencesFromContent } from '@/lib/data/helpers/extract-references';
import { dbFileToFileState } from '@/lib/api/compress-augmented';
import { sortObjectKeysDeep } from '@/lib/api/file-encoding';
import { immutableSet } from '@/lib/utils/immutable-collections';

// System file types that save in-place and are excluded from bulk Publish.
// Defined as a Set here (instead of importing from file-metadata) to avoid
// circular-dependency issues between store and ui modules.
const SYSTEM_FILE_TYPES_SET = immutableSet<string>(['connection', 'config', 'styles']);

/**
 * Ephemeral changes - non-persistent state like lastExecuted query
 */
export interface ExecutedSnapshot {
  query: string;
  params: Record<string, any>;
  database: string;
  references: any[];
}

export type EphemeralChanges = Partial<DbFile['content']> & {
  lastExecuted?: ExecutedSnapshot;
  // Notebooks only: what each SQL cell last ran, keyed by cell id. Drives each
  // cell's useQueryResult so an agent EditFile (or a user Run) surfaces results.
  // Like lastExecuted, it's UI-only and never persisted (selectPersistableContent
  // drops ephemerals).
  cellExecuted?: Record<string, ExecutedSnapshot>;
};

/**
 * FileState: Complete file state including metadata and change tracking
 * Extends DbFile with UI state and change tracking
 * Implements Core Patterns architecture from Phase 1
 */
export interface FileState extends DbFile {
  // Computed references (IDs of referenced files from content.assets)
  references: number[];

  // Computed query result hash (for questions only)
  queryResultId?: string;

  // UI state tracking
  loading: boolean;
  saving: boolean;    // Phase 2: Track save operations
  updatedAt: number;  // Timestamp of last fetch (for TTL checks)
  loadError: LoadError | null;  // Error from last load attempt

  // Change tracking (Phase 2)
  persistableChanges: Partial<DbFile['content']>;
  // When true, persistableChanges holds the FULL content (set via setFullContent,
  // e.g. JSON editors) and replaces file.content on save instead of merging —
  // this is what lets key deletions persist. Subsequent setEdit merges keep the
  // invariant (merging onto full content yields full content).
  contentReplaced?: boolean;
  ephemeralChanges: EphemeralChanges;
  metadataChanges: { name?: string; path?: string }; // Phase 5: Metadata edits

  // Analytics summary (loaded alongside the file, never blocks file loading)
  analytics?: FileAnalyticsSummary | null;
  // Conversation-level LLM analytics (only populated for conversation files)
  conversationAnalytics?: ConversationAnalyticsSummary | null;
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
// djb2-style hash — stays within 32-bit range
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/** Deterministic placeholder ID for a path being loaded (negative, within int4). */
function pathToVirtualId(path: string): number {
  // Kept within int4 range [-2^31, -1] so it never overflows an `integer` column.
  // Must match lib/api/file-state.ts:pathToPlaceholderId (same path → same ID).
  return -(1 + (Math.abs(hashString(path)) % 2_000_000_000));
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
      analytics?: FileAnalyticsSummary | null;
      conversationAnalytics?: ConversationAnalyticsSummary | null;
    }>) {
      const { file, references = [] } = action.payload;

      const existing = state.files[file.id];

      // Store the main file — preserve existing analytics when not explicitly provided
      state.files[file.id] = {
        ...dbFileToFileState(file),
        analytics: 'analytics' in action.payload
          ? action.payload.analytics
          : existing?.analytics,
        conversationAnalytics: 'conversationAnalytics' in action.payload
          ? action.payload.conversationAnalytics
          : existing?.conversationAnalytics,
      };

      // Update path index (only for real files with positive IDs)
      // Cleanup: remove path-placeholder when real file arrives
      if (file.id > 0) {
        const oldId = state.pathIndex[file.path];
        if (oldId !== undefined && oldId < 0) {
          delete state.files[oldId];
        }
        state.pathIndex[file.path] = file.id;

        // Draft → published: clean up old token path and surface in parent folder
        if (existing?.draft && !file.draft) {
          if (existing.path && existing.path !== file.path) {
            delete state.pathIndex[existing.path];
          }
          const parentPath = file.path.substring(0, file.path.lastIndexOf('/')) || '/';
          const parentId = state.pathIndex[parentPath];
          if (parentId && state.files[parentId]) {
            if (!state.files[parentId].references.includes(file.id)) {
              state.files[parentId].references.push(file.id);
            }
            state.files[parentId].updatedAt = Date.now();
          }
        }
      }

      // Store all referenced files
      references.forEach(ref => {
        state.files[ref.id] = dbFileToFileState(ref);

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
      analyticsMap?: Record<number, FileAnalyticsSummary>;
    }>) {
      const { files, references = [], analyticsMap } = action.payload;

      // Store all main files
      files.forEach(file => {
        const fileState = dbFileToFileState(file);
        // Folders: preserve children already set by setFolderInfo instead of re-extracting
        if (file.type === 'folder') {
          fileState.references = state.files[file.id]?.references ?? [];
        }
        state.files[file.id] = fileState;

        if (analyticsMap?.[file.id] !== undefined) {
          state.files[file.id].analytics = analyticsMap[file.id];
        }

        // Update path index
        state.pathIndex[file.path] = file.id;
      });

      // Store all referenced files
      references.forEach(ref => {
        state.files[ref.id] = dbFileToFileState(ref);
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
          // Folders preserve their resolved children; everything else takes the
          // metadata payload's references. Wrap in Array.isArray so a malformed
          // (non-array) value never lands in Redux — selectors iterate this and
          // crash with "object is not iterable" if it's a truthy non-array.
          const candidate = fileInfo.type === 'folder'
            ? (state.files[fileInfo.id]?.references ?? fileInfo.references)
            : fileInfo.references;
          state.files[fileInfo.id] = {
            ...state.files[fileInfo.id],
            name: fileInfo.name,
            path: fileInfo.path,
            type: fileInfo.type,
            references: Array.isArray(candidate) ? candidate : [],
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
          version: 1,
          last_edit_id: null,
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
        version: 1,
        last_edit_id: null,
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
          version: 1,
          last_edit_id: null,
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

        state.files[fileId].persistableChanges = sortObjectKeysDeep(newPersistableChanges) as any;
      }
    },

    /**
     * Set a file's static-JSX body (File Architecture v2). jsx is persisted
     * immediately via its own endpoint, so this just reflects the saved value in
     * Redux (no draft/persistableChanges staging for jsx in M1).
     */
    setJsx(state, action: PayloadAction<{ fileId: FileId; jsx: string }>) {
      const { fileId, jsx } = action.payload;
      if (state.files[fileId]) {
        state.files[fileId].jsx = jsx;
      }
    },

    /**
     * Replace entire content (not merge)
     * Used by JSON editors where the full content is provided
     */
    setFullContent(state, action: PayloadAction<{ fileId: FileId; content: DbFile['content'] }>) {
      const { fileId, content } = action.payload;
      if (state.files[fileId]) {
        // Store the full new content as persistableChanges
        // On save, this replaces file.content entirely
        state.files[fileId].persistableChanges = sortObjectKeysDeep(content) as any;
        state.files[fileId].contentReplaced = true;
      }
    },

    /**
     * Clear edits after save (Phase 2)
     */
    clearEdits(state, action: PayloadAction<FileId>) {
      if (state.files[action.payload]) {
        state.files[action.payload].persistableChanges = {};
        state.files[action.payload].contentReplaced = false;
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
     * Set a single notebook cell's executed snapshot (notebooks only).
     * Merges per-cell so other cells' executed state is preserved — unlike
     * setEphemeral, which would replace the whole cellExecuted map.
     */
    setNotebookCellExecuted(state, action: PayloadAction<{ fileId: FileId; cellId: string; executed: ExecutedSnapshot }>) {
      const { fileId, cellId, executed } = action.payload;
      const file = state.files[fileId];
      if (!file) return;
      const prev = file.ephemeralChanges.cellExecuted ?? {};
      file.ephemeralChanges = {
        ...file.ephemeralChanges,
        cellExecuted: { ...prev, [cellId]: executed },
      };
    },

    /**
     * Replace a notebook's whole cellResults map in persistableChanges (notebooks
     * only). cellResults needs REPLACE semantics — selectMergedContent shallow-
     * overlays persistableChanges onto content, so a partial map would drop the
     * unlisted (already-saved) cells, and deepMerge can't delete a cell's entry.
     * Callers compute the full next map (add/prune) and pass it here.
     */
    setNotebookCellResults(state, action: PayloadAction<{ fileId: FileId; cellResults: Record<string, unknown> }>) {
      const { fileId, cellResults } = action.payload;
      const file = state.files[fileId];
      if (!file) return;
      // Cast: callers build the map from loosely-typed snapshots; the runtime
      // shape matches NotebookContent.cellResults.
      file.persistableChanges = { ...file.persistableChanges, cellResults: cellResults as any };
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
      const updatedChanges = { ...changes };
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
          version: 1,
          last_edit_id: null,
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
            references: Array.isArray(fileInfo.references) ? fileInfo.references : [],
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

      // Add the new file
      state.files[file.id] = dbFileToFileState(file);

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
        id: questionId,
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
     * Add a text block (InlineAsset) to a dashboard
     * - Generate a UUID for the text block
     * - Add InlineAsset to assets and DashboardLayoutItem to layout
     */
    addTextBlockToDashboard(state, action: PayloadAction<{ dashboardId: number }>) {
      const { dashboardId } = action.payload;
      const dashboard = state.files[dashboardId];
      if (!dashboard || dashboard.type !== 'dashboard') return;

      const content = dashboard.content as DocumentContent | null;
      const changes = dashboard.persistableChanges as Partial<DocumentContent> | undefined;
      if (!content) return;

      const currentAssets = changes?.assets ?? content.assets ?? [];
      const currentLayout = changes?.layout ?? content.layout ?? { columns: 12, items: [] };

      const textId = crypto.randomUUID();

      const newAsset: AssetReference = {
        type: 'text',
        id: textId,
        content: '',
      };

      // Find bottom of grid
      const maxY = currentLayout.items?.reduce((max: number, item: any) => {
        return Math.max(max, (item.y ?? 0) + (item.h ?? 4));
      }, 0) ?? 0;

      const newLayoutItem = {
        id: textId,
        x: 0,
        y: maxY,
        w: 12,
        h: 3,
      };

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
     * Update the content of a text block in a dashboard
     */
    updateTextBlockContent(state, action: PayloadAction<{ dashboardId: number; textBlockId: string; content: string }>) {
      const { dashboardId, textBlockId, content: newContent } = action.payload;
      const dashboard = state.files[dashboardId];
      if (!dashboard || dashboard.type !== 'dashboard') return;

      const dbContent = dashboard.content as DocumentContent | null;
      const changes = dashboard.persistableChanges as Partial<DocumentContent> | undefined;
      if (!dbContent) return;

      const currentAssets = changes?.assets ?? dbContent.assets ?? [];
      const updatedAssets = currentAssets.map((asset: AssetReference) => {
        if (asset.type !== 'question' && asset.id === textBlockId) {
          return { ...asset, content: newContent };
        }
        return asset;
      });

      state.files[dashboardId].persistableChanges = {
        ...changes,
        assets: updatedAssets,
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

  }
});

/**
 * Helper: Compute queryResultId for a question file and strip it from content
 * Returns { queryResultId, content } where content has queryResultId removed
 */

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
  setJsx,
  setFullContent,
  clearEdits,
  setEphemeral,
  setNotebookCellExecuted,
  setNotebookCellResults,
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
  addTextBlockToDashboard,
  updateTextBlockContent,
  addReferenceToQuestion,
  removeReferenceFromQuestion,
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
 * Get a notebook's per-cell executed snapshots (UI-only ephemeral state).
 * Keyed by cell id; drives each SQL cell's useQueryResult.
 */
export const selectNotebookCellExecuted = (
  state: RootState,
  fileId: FileId,
): Record<string, ExecutedSnapshot> | undefined =>
  state.files.files[fileId]?.ephemeralChanges?.cellExecuted;

/**
 * Compute the content that would be persisted on save for a file state:
 * the full persistableChanges when content was replaced (setFullContent),
 * otherwise content merged with persistableChanges. Never includes ephemerals.
 */
export function persistableContentOf(file: Pick<FileState, 'content' | 'persistableChanges' | 'contentReplaced'>): DbFile['content'] | undefined {
  const hasEdits = file.persistableChanges && Object.keys(file.persistableChanges).length > 0;
  if (file.contentReplaced && hasEdits) {
    return file.persistableChanges as DbFile['content'];
  }
  if (!file.content) return undefined;
  return hasEdits ? { ...file.content, ...file.persistableChanges } as DbFile['content'] : file.content;
}

/**
 * Get the persistable content (content + persistableChanges, NO ephemerals).
 * This is what the JSON view edits and what publishFile saves.
 * Memoized to prevent unnecessary re-renders.
 */
export const selectPersistableContent = createSelector(
  [
    (state: RootState, id: FileId) => state.files.files[id]?.content,
    (state: RootState, id: FileId) => state.files.files[id]?.persistableChanges,
    (state: RootState, id: FileId) => state.files.files[id]?.contentReplaced
  ],
  (content, persistableChanges, contentReplaced): DbFile['content'] | undefined =>
    persistableContentOf({ content, persistableChanges: persistableChanges ?? {}, contentReplaced })
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

  const hasContentChanges = !!(file.persistableChanges && Object.keys(file.persistableChanges).length > 0);
  const hasMetadataChanges = !!(file.metadataChanges && (file.metadataChanges.name !== undefined || file.metadataChanges.path !== undefined));

  return hasContentChanges || hasMetadataChanges;
};

/**
 * Get effective file name (with pending metadata changes) (Phase 5)
 */
export function effectiveName(file: FileState): string {
  return file.metadataChanges?.name ?? file.name;
}

export const selectEffectiveName = (state: RootState, id: FileId): string | undefined => {
  const file = state.files.files[id];
  if (!file) return undefined;
  return effectiveName(file);
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
export const selectDirtyFiles = createSelector(
  [(state: RootState) => state.files.files],
  (files): FileState[] =>
    Object.values(files).filter(file => {
      if (!file || SYSTEM_FILE_TYPES_SET.has(file.type)) return false;

      const hasContentChanges = !!(file.persistableChanges && Object.keys(file.persistableChanges).length > 0);
      const hasMetadataChanges = !!(file.metadataChanges && (file.metadataChanges.name !== undefined || file.metadataChanges.path !== undefined));

      return hasContentChanges || hasMetadataChanges;
    }) as FileState[]
);

/**
 * Classify dirty files relative to the current file being viewed.
 * - currentDirty: whether the current file itself has unsaved changes
 * - childDirtyFiles: dirty files referenced by the current file (e.g., questions in a dashboard)
 * - unrelatedDirtyFiles: dirty files that are NOT the current file or its children
 *
 * When fileId is undefined (e.g., folder pages), all dirty files are "unrelated".
 */
// Memoized so it returns a STABLE object reference for unchanged inputs (a plain
// function returned a fresh object every call → React-Redux's "selector returned
// a different result" warning + needless re-renders). `weakMapMemoize` caches per
// distinct (state, fileId) args, so it doesn't thrash when multiple components use
// it with different fileIds (reselect's default lru cache size is 1).
export const selectSaveClassification = createSelector(
  [
    selectDirtyFiles,
    (_state: RootState, fileId: number | undefined) => fileId,
    (state: RootState, fileId: number | undefined) =>
      fileId === undefined ? undefined : state.files.files[fileId],
    (state: RootState, fileId: number | undefined) =>
      fileId === undefined ? undefined : selectMergedContent(state, fileId),
  ],
  (allDirty, fileId, fileState, mergedContent) => {
    if (fileId === undefined) {
      return { currentDirty: false, childDirtyFiles: [] as FileState[], unrelatedDirtyFiles: allDirty };
    }
    const childIds = new Set(
      fileState && mergedContent
        ? extractReferencesFromContent(mergedContent as any, fileState.type as FileType)
        : []
    );
    return {
      currentDirty: allDirty.some(f => f.id === fileId),
      childDirtyFiles: allDirty.filter(f => f.id !== fileId && childIds.has(f.id)),
      unrelatedDirtyFiles: allDirty.filter(f => f.id !== fileId && !childIds.has(f.id)),
    };
  },
  { memoize: weakMapMemoize, argsMemoize: weakMapMemoize },
);

export const selectConnectionsLoading = createSelector(
  [(state: RootState) => state.files.files],
  (files) => Object.values(files).some(f => f.type === 'connection' && f.loading === true)
);

export const selectConnectionIds = createSelector(
  [(state: RootState) => state.files.files],
  (files) => Object.values(files)
    .filter(f => f.type === 'connection' && f.id > 0)
    .map(f => f.id as number)
);

export const selectDashboardFiles = createSelector(
  [(state: RootState) => state.files.files],
  (files) => Object.values(files).filter(f => f.type === 'dashboard' && f.id > 0)
);

export const selectQuestionFiles = createSelector(
  [(state: RootState) => state.files.files],
  (files) => Object.values(files).filter(f => f.type === 'question' && f.id > 0)
);

// Boolean selectors — return primitives so useAppSelector never triggers spurious re-renders.
// Use these in DataLoader instead of subscribing to the full files dictionary.
export const selectConnectionsContentLoaded = createSelector(
  [(state: RootState) => state.files.files],
  (files) => Object.values(files).some(f => f.type === 'connection' && f.content !== null)
);

export const selectContextsContentLoaded = createSelector(
  [(state: RootState) => state.files.files],
  (files) => Object.values(files).some(f => f.type === 'context')
);

// ============================================================================
// BACKWARDS COMPATIBILITY: Connection selectors
// ============================================================================
// These maintain the same API as old connectionsSlice for gradual migration

export interface ConnectionWithSchema {
  metadata: {
    name: string;
    type: 'duckdb' | 'bigquery' | 'postgresql' | 'csv' | 'google-sheets' | 'athena' | 'sqlite' | 'internal_db' | 'clickhouse';
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
 * Get current parameter values for a file (from merged content)
 * Used by question/dashboard views for param display and execution
 */
const EMPTY_PARAM_VALUES: Record<string, any> = {};
export const selectParamValues = (state: RootState, id: FileId): Record<string, any> => {
  const content = selectMergedContent(state, id) as any;
  return content?.parameterValues || EMPTY_PARAM_VALUES;
};

export default filesSlice.reducer;
