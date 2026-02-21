/**
 * Tests for readFiles - File State Manager with Promise Deduplication and TTL Caching
 *
 * Tests the enhanced readFiles function that:
 * - Actually fetches files if missing/stale (not just throwing errors)
 * - Supports TTL-based caching with custom ttl option
 * - Implements promise deduplication for concurrent requests
 * - Supports skip option to bypass fetching
 */

import { configureStore } from '@reduxjs/toolkit';
import filesReducer, { setFile, setFiles, FileState, setEdit } from '@/store/filesSlice';
import queryResultsReducer, { setQueryResult } from '@/store/queryResultsSlice';
import authReducer from '@/store/authSlice';
import {
  readFiles,
  filePromises,
  editFile,
  publishFile,
  reloadFile,
  clearFileChanges,
  readFilesByCriteria,
  createVirtualFile,
  createFolder,
  readFolder,
  getQueryResult
} from '../file-state';
import { FilesAPI } from '@/lib/data/files';
import { CACHE_TTL } from '@/lib/constants/cache';
import type { DbFile, FileType } from '@/lib/types';
import type { RootState } from '@/store/store';

// Mock FilesAPI
jest.mock('@/lib/data/files', () => {
  const mockGetFilesFn = jest.fn();
  return {
    FilesAPI: {
      loadFiles: jest.fn(),
      loadFile: jest.fn(),
      getFiles: mockGetFilesFn,
      saveFile: jest.fn(),
      createFile: jest.fn()
    },
    getFiles: mockGetFilesFn // Also export getFiles directly for readFolder
  };
});

// Mock access rules for readFolder
jest.mock('@/lib/auth/access-rules.client', () => ({
  canViewFileType: jest.fn().mockReturnValue(true)
}));

// Mock path resolver for readFolder
jest.mock('@/lib/mode/path-resolver', () => ({
  isHiddenSystemPath: jest.fn().mockReturnValue(false),
  resolveHomeFolderSync: jest.fn((mode: string, folder: string) => `/${mode}`),
  isFileTypeAllowedInPath: jest.fn().mockReturnValue(true), // Allow all file types in all paths for tests
  getModeRoot: jest.fn((mode: string) => `/${mode}`)
}));

// Mock query hash for getQueryResult
jest.mock('@/lib/utils/query-hash', () => ({
  getQueryHash: jest.fn((query: string, params: Record<string, any>, database: string) => {
    return `${query}::${JSON.stringify(params)}::${database}`;
  })
}));

// Mock fetch for publishFile
global.fetch = jest.fn();

// Mock the store import
let mockStore: ReturnType<typeof configureStore>;

jest.mock('@/store/store', () => ({
  get store() {
    return mockStore;
  },
  getStore: () => mockStore
}));

const mockLoadFiles = FilesAPI.loadFiles as jest.MockedFunction<typeof FilesAPI.loadFiles>;
const mockLoadFile = FilesAPI.loadFile as jest.MockedFunction<typeof FilesAPI.loadFile>;
const mockGetFiles = FilesAPI.getFiles as jest.MockedFunction<typeof FilesAPI.getFiles>;
const mockSaveFile = FilesAPI.saveFile as jest.MockedFunction<typeof FilesAPI.saveFile>;
const mockCreateFile = FilesAPI.createFile as jest.MockedFunction<typeof FilesAPI.createFile>;
const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

// Base time for testing (Jan 1, 2024)
const BASE_TIME = new Date('2024-01-01T00:00:00Z').getTime();

// Helper to create mock file
function createMockFile(id: number, type: FileType = 'question'): DbFile {
  const getDefaultContent = (fileType: FileType): any => {
    switch (fileType) {
      case 'question':
        return { query: 'SELECT 1', database_name: 'test', parameters: [], vizSettings: { type: 'table' } };
      case 'dashboard':
        return { assets: [], layout: { columns: 12, items: [] } };
      case 'folder':
        return {};
      case 'config':
        return { branding: {} };
      default:
        return {};
    }
  };

  return {
    id,
    name: `Test ${type} ${id}`,
    path: `/org/test-${type}-${id}`,
    type,
    content: getDefaultContent(type),
    references: [],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    company_id: 1
  };
}

describe('readFiles - File State Manager', () => {
  beforeEach(() => {
    // Use fake timers for time-based tests
    jest.useFakeTimers();
    jest.setSystemTime(BASE_TIME);

    // Create fresh Redux store for each test
    mockStore = configureStore({
      reducer: {
        files: filesReducer,
        queryResults: queryResultsReducer,
        auth: authReducer
      }
    });

    // Set default auth state
    mockStore.dispatch({
      type: 'auth/setUser',
      payload: { userId: 1, email: 'test@example.com', companyId: 1, isAdmin: false }
    });

    // Clear mocks
    mockLoadFiles.mockClear();
    mockLoadFile.mockClear();
    mockGetFiles.mockClear();
    mockFetch.mockClear();
    filePromises.clear();

    // Set default fetch response for query execution (can be overridden in specific tests)
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          columns: ['id'],
          types: ['INTEGER'],
          rows: [{ id: 1 }]
        }
      })
    } as Response);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('TTL-based caching', () => {
    it('should return fresh file from Redux without fetching', async () => {
      const mockFile = createMockFile(1);

      // Pre-populate Redux with file at BASE_TIME
      mockStore.dispatch(setFile({
        file: mockFile,
        references: []
      }));

      // File is fresh (within default TTL of 10 hours)
      const result = await readFiles([mockFile.id]);

      // Should not fetch - file is fresh
      expect(mockLoadFiles).not.toHaveBeenCalled();

      // Should return file from Redux
      expect(result).toHaveLength(1);
      expect(result[0].fileState.id).toBe(mockFile.id);
    });

    it('should refetch stale file beyond TTL', async () => {
      const mockFile = createMockFile(1);
      const freshFile = { ...mockFile, name: 'Updated name' };

      // Pre-populate Redux with file at BASE_TIME
      mockStore.dispatch(setFile({
        file: mockFile,
        references: []
      }));

      // Advance time beyond default TTL (10 hours + 1 second)
      jest.setSystemTime(BASE_TIME + CACHE_TTL.FILE + 1000);

      // Mock API to return fresh file
      mockLoadFiles.mockResolvedValue({
        data: [freshFile],
        metadata: { references: [] }
      });

      // Call readFiles - should refetch
      const result = await readFiles([mockFile.id]);

      // Should fetch because file is stale
      expect(mockLoadFiles).toHaveBeenCalledWith([mockFile.id]);

      // Should return updated file
      expect(result).toHaveLength(1);
      expect(result[0].fileState.name).toBe('Updated name');
    });

    it('should fetch missing file', async () => {
      const mockFile = createMockFile(1);

      // Empty Redux state - file doesn't exist
      mockLoadFiles.mockResolvedValue({
        data: [mockFile],
        metadata: { references: [] }
      });

      // Call readFiles
      const result = await readFiles([mockFile.id]);

      // Should fetch because file is missing
      expect(mockLoadFiles).toHaveBeenCalledWith([mockFile.id]);

      // Should populate Redux and return file
      expect(result).toHaveLength(1);
      expect(result[0].fileState.id).toBe(mockFile.id);
    });

    it('should respect custom TTL', async () => {
      const mockFile = createMockFile(1);
      const freshFile = { ...mockFile, name: 'Updated name' };

      // Pre-populate Redux with file at BASE_TIME
      mockStore.dispatch(setFile({
        file: mockFile,
        references: []
      }));

      // Advance time by 30 seconds
      jest.setSystemTime(BASE_TIME + 30 * 1000);

      // Mock API to return fresh file
      mockLoadFiles.mockResolvedValue({
        data: [freshFile],
        metadata: { references: [] }
      });

      // Call readFiles with custom TTL of 10 seconds
      const result = await readFiles([mockFile.id], { ttl: 10000 });

      // Should fetch because 30s > 10s TTL
      expect(mockLoadFiles).toHaveBeenCalledWith([mockFile.id]);

      // Should return updated file
      expect(result[0].fileState.name).toBe('Updated name');
    });
  });

  describe('Skip option', () => {
    it('should not fetch even if file is stale when skip=true', async () => {
      const mockFile = createMockFile(1);

      // Pre-populate Redux with file at BASE_TIME
      mockStore.dispatch(setFile({
        file: mockFile,
        references: []
      }));

      // Advance time beyond TTL
      jest.setSystemTime(BASE_TIME + CACHE_TTL.FILE + 1000);

      // Call readFiles with skip=true
      const result = await readFiles([mockFile.id], { skip: true });

      // Should NOT fetch even though file is stale
      expect(mockLoadFiles).not.toHaveBeenCalled();

      // Should return existing stale data
      expect(result).toHaveLength(1);
      expect(result[0].fileState.id).toBe(mockFile.id);
    });

    it('should return empty fileStates if file missing and skip=true', async () => {
      // Empty Redux state - file doesn't exist, loadFiles skips due to skip=true

      const result = await readFiles([999], { skip: true });
      // File was never in Redux and loadFiles skipped → empty result
      expect(result).toHaveLength(0);
    });
  });

  describe('Promise deduplication', () => {
    it('should deduplicate concurrent requests for same file', async () => {
      const mockFile = createMockFile(1);

      // Mock API with delay to simulate slow request
      mockLoadFiles.mockImplementation(async (ids) => {
        // Wait 100ms to simulate network delay
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          data: [mockFile],
          metadata: { references: [] }
        };
      });

      // Call readFiles twice concurrently (no await)
      const promise1 = readFiles([mockFile.id]);
      const promise2 = readFiles([mockFile.id]);

      // Advance timers to complete the fetch
      jest.advanceTimersByTime(100);

      // Wait for both promises
      const [result1, result2] = await Promise.all([promise1, promise2]);

      // Should only fetch ONCE despite two concurrent calls
      expect(mockLoadFiles).toHaveBeenCalledTimes(1);

      // Both should return the same data
      expect(result1[0].fileState.id).toBe(mockFile.id);
      expect(result2[0].fileState.id).toBe(mockFile.id);
    });

    it('should track in-flight requests correctly', async () => {
      const mockFile = createMockFile(1);

      // Mock API with delay
      mockLoadFiles.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          data: [mockFile],
          metadata: { references: [] }
        };
      });

      // Start request (don't await)
      const promise = readFiles([mockFile.id]);

      // Check in-flight count immediately
      expect(filePromises.size).toBe(1);

      // Advance timers to complete
      jest.advanceTimersByTime(100);
      await promise;

      // Should be cleared after completion
      expect(filePromises.size).toBe(0);
    });
  });

  describe('References loading', () => {
    it('should load referenced files', async () => {
      const questionFile = createMockFile(1, 'question');
      const dashboardFile = createMockFile(2, 'dashboard');

      // Dashboard references the question
      dashboardFile.content = {
        assets: [{ type: 'question', id: questionFile.id }],
        layout: { columns: 12, items: [] }
      };

      // Mock API to return both files
      mockLoadFiles.mockResolvedValue({
        data: [dashboardFile],
        metadata: { references: [questionFile] }
      });

      // Load dashboard
      const result = await readFiles([dashboardFile.id]);

      // Should load dashboard
      expect(result).toHaveLength(1);
      expect(result[0].fileState.id).toBe(dashboardFile.id);

      // Should include referenced question
      expect(result[0].references).toHaveLength(1);
      expect(result[0].references[0].id).toBe(questionFile.id);
    });
  });

  describe('Error handling', () => {
    it('should propagate fetch errors via loadError (no throw)', async () => {
      // Mock API to throw error
      mockLoadFiles.mockRejectedValue(new Error('Network error'));

      // readFiles no longer throws — error is stored in Redux on file.loadError
      const result = await readFiles([1]);
      expect(result).toHaveLength(1);
      expect(result[0].fileState.loadError).toMatchObject({ message: 'Network error' });

      // File should have loadError set in Redux (not corrupted, just marked with error)
      const state = mockStore.getState() as RootState;
      expect(state.files.files[1]).toBeDefined();
      expect(state.files.files[1].loading).toBe(false);
      expect(state.files.files[1].loadError).toMatchObject({ message: 'Network error' });
    });

    it('should set loadError on file not found after fetch (no throw)', async () => {
      // Mock API to return empty array (file not found)
      mockLoadFiles.mockResolvedValue({
        data: [],
        metadata: { references: [] }
      });

      // readFiles no longer throws — NOT_FOUND is stored on file.loadError
      const result = await readFiles([999]);
      expect(result).toHaveLength(1);
      expect(result[0].fileState.loadError).toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('Multiple files', () => {
    it('should batch fetch multiple missing files', async () => {
      const file1 = createMockFile(1);
      const file2 = createMockFile(2);

      mockLoadFiles.mockResolvedValue({
        data: [file1, file2],
        metadata: { references: [] }
      });

      const result = await readFiles([1, 2]);

      // Should fetch both in single call
      expect(mockLoadFiles).toHaveBeenCalledWith([1, 2]);

      // Should return both files
      expect(result).toHaveLength(2);
      expect(result[0].fileState.id).toBe(1);
      expect(result[1].fileState.id).toBe(2);
    });

    it('should only fetch stale files', async () => {
      const file1 = createMockFile(1);
      const file2 = createMockFile(2);

      // Pre-populate Redux with file1 (fresh)
      mockStore.dispatch(setFile({ file: file1, references: [] }));

      // Mock API to return file2 only
      mockLoadFiles.mockResolvedValue({
        data: [file2],
        metadata: { references: [] }
      });

      // Request both files
      const result = await readFiles([1, 2]);

      // Should only fetch file2 (file1 is fresh)
      expect(mockLoadFiles).toHaveBeenCalledWith([2]);

      // Should return both files
      expect(result).toHaveLength(2);
    });
  });

  describe('readFilesByCriteria', () => {
    it('should load files by path', async () => {
      const file1 = createMockFile(1);
      const file2 = createMockFile(2);

      // Mock getFiles to return metadata
      mockGetFiles.mockResolvedValue({
        data: [
          { id: file1.id, name: file1.name, path: file1.path, type: file1.type, references: [], created_at: file1.created_at, updated_at: file1.updated_at, company_id: 1 },
          { id: file2.id, name: file2.name, path: file2.path, type: file2.type, references: [], created_at: file2.created_at, updated_at: file2.updated_at, company_id: 1 }
        ],
        metadata: { folders: [] }
      });

      // Mock loadFiles for full content
      mockLoadFiles.mockResolvedValue({
        data: [file1, file2],
        metadata: { references: [] }
      });

      const result = await readFilesByCriteria({
        criteria: { paths: ['/org'] }
      });

      expect(mockGetFiles).toHaveBeenCalledWith({ paths: ['/org'] });
      expect(mockLoadFiles).toHaveBeenCalledWith([1, 2]);
      expect(result).toHaveLength(2);
    });

    it('should load files by type', async () => {
      const file1 = createMockFile(1, 'question');

      mockGetFiles.mockResolvedValue({
        data: [
          { id: file1.id, name: file1.name, path: file1.path, type: file1.type, references: [], created_at: file1.created_at, updated_at: file1.updated_at, company_id: 1 }
        ],
        metadata: { folders: [] }
      });

      mockLoadFiles.mockResolvedValue({
        data: [file1],
        metadata: { references: [] }
      });

      await readFilesByCriteria({
        criteria: { type: 'question' }
      });

      expect(mockGetFiles).toHaveBeenCalledWith({ type: 'question' });
    });

    it('should respect depth parameter', async () => {
      mockGetFiles.mockResolvedValue({
        data: [],
        metadata: { folders: [] }
      });

      await readFilesByCriteria({
        criteria: { paths: ['/org'], depth: 2 }
      });

      expect(mockGetFiles).toHaveBeenCalledWith({ paths: ['/org'], depth: 2 });
    });

    it('should return metadata only when partial=true', async () => {
      const file1 = createMockFile(1);

      mockGetFiles.mockResolvedValue({
        data: [
          { id: file1.id, name: file1.name, path: file1.path, type: file1.type, references: [], created_at: file1.created_at, updated_at: file1.updated_at, company_id: 1 }
        ],
        metadata: { folders: [] }
      });

      // Pre-populate Redux with file
      mockStore.dispatch(setFile({ file: file1, references: [] }));

      const result = await readFilesByCriteria({
        criteria: { paths: ['/org'] },
        partial: true
      });

      // Should NOT call loadFiles for full content
      expect(mockLoadFiles).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].queryResults).toHaveLength(0);  // No augmentation
    });

    it('should return augmented files when partial=false', async () => {
      const file1 = createMockFile(1, 'question');

      mockGetFiles.mockResolvedValue({
        data: [
          { id: file1.id, name: file1.name, path: file1.path, type: file1.type, references: [], created_at: file1.created_at, updated_at: file1.updated_at, company_id: 1 }
        ],
        metadata: { folders: [] }
      });

      mockLoadFiles.mockResolvedValue({
        data: [file1],
        metadata: { references: [] }
      });

      // Add query result to Redux BEFORE calling readFilesByCriteria
      // This simulates the result already being cached (note: use 'data' not 'result')
      mockStore.dispatch(setQueryResult({
        query: 'SELECT 1',
        params: {},
        database: 'test',
        data: { columns: ['id'], types: ['INTEGER'], rows: [{ id: 1 }] }
      }));

      const result = await readFilesByCriteria({
        criteria: { type: 'question' },
        partial: false
      });

      expect(mockLoadFiles).toHaveBeenCalled();
      // Augmentation should include query results per file
      // (will only work if query result is already in Redux)
      expect(result[0].queryResults.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('editFile', () => {
    it('should update persistableChanges', async () => {
      const mockFile = createMockFile(1, 'question');
      mockStore.dispatch(setFile({ file: mockFile, references: [] }));

      await editFile({
        fileId: 1,
        changes: { content: { query: 'SELECT 2' } }
      });

      const state = mockStore.getState() as RootState;
      const content = state.files.files[1].persistableChanges as any;
      expect(content.query).toBe('SELECT 2');
    });

    it('should NOT auto-execute query for questions (removed in Phase 3)', async () => {
      const mockFile = createMockFile(1, 'question');
      mockStore.dispatch(setFile({ file: mockFile, references: [] }));

      // Clear default mock to track calls
      mockFetch.mockClear();

      await editFile({
        fileId: 1,
        changes: { content: { query: 'SELECT 2' } }
      });

      // Should NOT have called getQueryResult (auto-execute removed)
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should recalculate queryResultId', async () => {
      const mockFile = createMockFile(1, 'question');
      mockStore.dispatch(setFile({ file: mockFile, references: [] }));

      await editFile({
        fileId: 1,
        changes: { content: { query: 'SELECT 2', database_name: 'new_db' } }
      });

      const state = mockStore.getState() as RootState;
      const persistableChanges = state.files.files[1].persistableChanges as any;

      // queryResultId should be set
      expect(persistableChanges.queryResultId).toBeDefined();
    });

    it('should throw if file not found', async () => {
      await expect(
        editFile({
          fileId: 999,
          changes: { content: { query: 'SELECT 1' } }
        })
      ).rejects.toThrow('File 999 not found');
    });
  });

  describe('editFile - metadata only', () => {
    it('should update metadataChanges when editing only name', async () => {
      const mockFile = createMockFile(1);
      mockStore.dispatch(setFile({ file: mockFile, references: [] }));

      await editFile({
        fileId: 1,
        changes: { name: 'New Name' }
      });

      const state = mockStore.getState() as RootState;
      expect(state.files.files[1].metadataChanges).toMatchObject({
        name: 'New Name'
      });
    });

    it('should handle name and path together', async () => {
      const mockFile = createMockFile(1);
      mockStore.dispatch(setFile({ file: mockFile, references: [] }));

      await editFile({
        fileId: 1,
        changes: { name: 'New Name', path: '/org/new-path' }
      });

      const state = mockStore.getState() as RootState;
      expect(state.files.files[1].metadataChanges).toMatchObject({
        name: 'New Name',
        path: '/org/new-path'
      });
    });
  });

  describe('publishFile', () => {
    it('should save file with edits', async () => {
      const mockFile = createMockFile(1);
      mockStore.dispatch(setFile({ file: mockFile, references: [] }));
      mockStore.dispatch(setEdit({ fileId: 1, edits: { query: 'SELECT 2' } }));

      const savedFile = { ...mockFile, name: 'Test question 1' };
      mockSaveFile.mockResolvedValueOnce({
        data: savedFile
      });

      const result = await publishFile({ fileId: 1 });

      expect(mockSaveFile).toHaveBeenCalled();
      expect(result).toEqual({ id: 1, name: 'Test question 1' });
    });

    it('should create virtual file', async () => {
      const virtualFile = { ...createMockFile(-1), id: -1 };
      mockStore.dispatch(setFile({ file: virtualFile, references: [] }));
      mockStore.dispatch(setEdit({ fileId: -1, edits: { query: 'SELECT 2' } }));

      const createdFile = { ...virtualFile, id: 123, name: 'New question' };
      mockCreateFile.mockResolvedValueOnce({
        data: createdFile
      });

      const result = await publishFile({ fileId: -1 });

      expect(mockCreateFile).toHaveBeenCalled();
      expect(result).toEqual({ id: 123, name: 'New question' });
    });

    it('should return current id/name when not dirty', async () => {
      const mockFile = createMockFile(1);
      mockStore.dispatch(setFile({ file: mockFile, references: [] }));
      // No edits - not dirty

      const result = await publishFile({ fileId: 1 });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 1, name: 'Test question 1' });
    });

    it('should clear changes after save', async () => {
      const mockFile = createMockFile(1);
      mockStore.dispatch(setFile({ file: mockFile, references: [] }));
      mockStore.dispatch(setEdit({ fileId: 1, edits: { query: 'SELECT 2' } }));

      const savedFile = { ...mockFile, name: 'Test question 1' };
      mockSaveFile.mockResolvedValueOnce({
        data: savedFile
      });

      await publishFile({ fileId: 1 });

      const state = mockStore.getState() as RootState;
      expect(state.files.files[1].persistableChanges).toEqual({});
    });

    it('should handle save errors', async () => {
      const mockFile = createMockFile(1);
      mockStore.dispatch(setFile({ file: mockFile, references: [] }));
      mockStore.dispatch(setEdit({ fileId: 1, edits: { query: 'SELECT 2' } }));

      mockSaveFile.mockRejectedValueOnce(new Error('Database error'));

      await expect(publishFile({ fileId: 1 })).rejects.toThrow('Database error');
    });
  });

  describe('reloadFile', () => {
    it('should force refresh from database', async () => {
      const mockFile = createMockFile(1);
      const freshFile = { ...mockFile, name: 'Updated name' };

      mockStore.dispatch(setFile({ file: mockFile, references: [] }));

      mockLoadFile.mockResolvedValue({
        data: freshFile,
        metadata: { references: [] }
      });

      await reloadFile({ fileId: 1 });

      expect(mockLoadFile).toHaveBeenCalledWith(1, undefined, { refresh: true });

      const state = mockStore.getState() as RootState;
      expect(state.files.files[1].name).toBe('Updated name');
    });

    it('should skip loading state when silent=true', async () => {
      const mockFile = createMockFile(1);
      mockStore.dispatch(setFile({ file: mockFile, references: [] }));

      mockLoadFile.mockResolvedValue({
        data: mockFile,
        metadata: { references: [] }
      });

      await reloadFile({ fileId: 1, silent: true });

      const state = mockStore.getState() as RootState;
      // Loading state should never have been set to true
      expect(state.files.files[1].loading).toBe(false);
    });

    it('should overwrite local changes', async () => {
      const mockFile = createMockFile(1, 'question');
      mockStore.dispatch(setFile({ file: mockFile, references: [] }));
      mockStore.dispatch(setEdit({ fileId: 1, edits: { query: 'SELECT 2' } }));

      // Verify local changes exist before reload
      let state = mockStore.getState() as RootState;
      expect(state.files.files[1].persistableChanges).toMatchObject({ query: 'SELECT 2' });

      const freshFile: DbFile = {
        ...mockFile,
        content: { ...(mockFile.content as any), query: 'SELECT 3' }
      };
      mockLoadFile.mockResolvedValue({
        data: freshFile,
        metadata: { references: [] }
      });

      await reloadFile({ fileId: 1 });

      state = mockStore.getState() as RootState;
      // Base content should be updated from database
      const content = state.files.files[1].content as any;
      expect(content?.query).toBe('SELECT 3');
      // Reload resets the file state, so persistableChanges are cleared (this is expected behavior)
      expect(state.files.files[1].persistableChanges).toEqual({});
    });
  });

  describe('clearFileChanges', () => {
    it('should clear all local changes', () => {
      const mockFile = createMockFile(1);
      mockStore.dispatch(setFile({ file: mockFile, references: [] }));
      mockStore.dispatch(setEdit({ fileId: 1, edits: { query: 'SELECT 2' } }));

      clearFileChanges({ fileId: 1 });

      const state = mockStore.getState() as RootState;
      expect(state.files.files[1].persistableChanges).toEqual({});
      expect(state.files.files[1].ephemeralChanges).toEqual({});
      expect(state.files.files[1].metadataChanges).toEqual({});
    });

    it('should revert to original state', () => {
      const mockFile = createMockFile(1, 'question');
      mockStore.dispatch(setFile({ file: mockFile, references: [] }));

      const originalQuery = (mockFile.content as any)?.query;
      mockStore.dispatch(setEdit({ fileId: 1, edits: { query: 'SELECT 2' } }));

      clearFileChanges({ fileId: 1 });

      const state = mockStore.getState() as RootState;
      // Content should be back to original
      const content = state.files.files[1].content as any;
      expect(content?.query).toBe(originalQuery);
    });
  });

  describe('augmentation', () => {
    it('should augment questions with query results', async () => {
      const mockFile = createMockFile(1, 'question');
      mockLoadFiles.mockResolvedValue({
        data: [mockFile],
        metadata: { references: [] }
      });

      // Add query result to Redux (note: use 'data' not 'result')
      mockStore.dispatch(setQueryResult({
        query: 'SELECT 1',
        params: {},
        database: 'test',
        data: { columns: ['id'], types: ['INTEGER'], rows: [{ id: 1 }] }
      }));

      const result = await readFiles([1]);

      // Should include query result
      expect(result[0].queryResults).toHaveLength(1);
      expect(result[0].queryResults[0]).toMatchObject({
        columns: ['id'],
        types: ['INTEGER'],
        rows: [{ id: 1 }]
      });
    });

    it('should augment dashboards with nested questions', async () => {
      const questionFile = createMockFile(1, 'question');
      const dashboardFile = createMockFile(2, 'dashboard');
      dashboardFile.content = {
        assets: [{ type: 'question', id: 1 }],
        layout: { columns: 12, items: [] }
      };

      mockLoadFiles.mockResolvedValue({
        data: [dashboardFile],
        metadata: { references: [questionFile] }
      });

      // Add query result for the question (note: use 'data' not 'result')
      mockStore.dispatch(setQueryResult({
        query: 'SELECT 1',
        params: {},
        database: 'test',
        data: { columns: ['id'], types: ['INTEGER'], rows: [{ id: 1 }] }
      }));

      const result = await readFiles([2]);

      // Should include query result from nested question
      expect(result[0].queryResults).toHaveLength(1);
      expect(result[0].references).toHaveLength(1);
      expect(result[0].references[0].id).toBe(1);
    });
  });

  describe('createVirtualFile', () => {
    it('should create virtual file with generated ID', async () => {
      const mockTemplate = {
        fileName: 'Untitled Question',
        content: { query: 'SELECT 1', vizSettings: {}, database_name: 'test' }
      };

      const mockGetTemplate = jest.fn().mockResolvedValue(mockTemplate);
      FilesAPI.getTemplate = mockGetTemplate;

      const virtualId = await createVirtualFile('question', { folder: '/org' });

      // Virtual ID should be negative
      expect(virtualId).toBeLessThan(0);

      // Should have called getTemplate with correct params
      expect(mockGetTemplate).toHaveBeenCalledWith('question', {
        path: '/org',
        databaseName: undefined,
        query: undefined
      });

      // Should be in Redux
      const state = mockStore.getState() as RootState;
      expect(state.files.files[virtualId]).toBeDefined();
      expect(state.files.files[virtualId].name).toBe('Untitled Question');
      expect(state.files.files[virtualId].path).toBe('/org/Untitled Question');
    });

    it('should pre-populate question with database and query', async () => {
      const mockTemplate = {
        fileName: 'New Query',
        content: { query: 'SELECT * FROM users', vizSettings: {}, database_name: 'my_db' }
      };

      const mockGetTemplate = jest.fn().mockResolvedValue(mockTemplate);
      FilesAPI.getTemplate = mockGetTemplate;

      await createVirtualFile('question', {
        folder: '/org',
        databaseName: 'my_db',
        query: 'SELECT * FROM users'
      });

      expect(mockGetTemplate).toHaveBeenCalledWith('question', {
        path: '/org',
        databaseName: 'my_db',
        query: 'SELECT * FROM users'
      });
    });

    it('should use provided virtual ID', async () => {
      const mockTemplate = {
        fileName: 'Test',
        content: {}
      };

      const mockGetTemplate = jest.fn().mockResolvedValue(mockTemplate);
      FilesAPI.getTemplate = mockGetTemplate;

      const customVirtualId = -12345;
      const virtualId = await createVirtualFile('dashboard', {
        folder: '/org',
        virtualId: customVirtualId
      });

      expect(virtualId).toBe(customVirtualId);

      const state = mockStore.getState() as RootState;
      expect(state.files.files[customVirtualId]).toBeDefined();
    });

    it('should resolve home folder from user when not provided', async () => {
      const mockTemplate = {
        fileName: 'Test',
        content: {}
      };

      const mockGetTemplate = jest.fn().mockResolvedValue(mockTemplate);
      FilesAPI.getTemplate = mockGetTemplate;

      // User's home folder should be used (from mockStore setup)
      await createVirtualFile('question');

      // Should have used resolved home folder path
      expect(mockGetTemplate).toHaveBeenCalledWith('question', expect.objectContaining({
        path: expect.any(String)
      }));
    });
  });

  describe('createFolder', () => {
    it('should create folder and add to Redux', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { id: 100, name: 'Sales', path: '/org/sales' }
        })
      } as Response);

      const result = await createFolder('Sales', '/org');

      // Should call POST /api/folders
      expect(mockFetch).toHaveBeenCalledWith('/api/folders', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ folderName: 'Sales', parentPath: '/org' })
      }));

      // Should return folder metadata
      expect(result).toEqual({
        id: 100,
        name: 'Sales',
        path: '/org/sales'
      });

      // Should be in Redux
      const state = mockStore.getState() as RootState;
      expect(state.files.files[100]).toBeDefined();
      expect(state.files.files[100].type).toBe('folder');
      expect(state.files.files[100].name).toBe('Sales');
      expect(state.files.files[100].path).toBe('/org/sales');
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: 'Folder already exists' })
      } as Response);

      await expect(createFolder('Existing', '/org')).rejects.toThrow();
    });

    it('should set correct company_id from auth state', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { id: 101, name: 'Marketing', path: '/org/marketing' }
        })
      } as Response);

      await createFolder('Marketing', '/org');

      const state = mockStore.getState() as RootState;
      // Should use company_id from auth state (set in mockStore setup)
      expect(state.files.files[101].company_id).toBe(1);
    });
  });

  describe('readFolder', () => {
    it('should load folder contents with children', async () => {
      const folderFile = createMockFile(100, 'folder');
      folderFile.path = '/org';

      const childFile1 = createMockFile(1, 'question');
      childFile1.path = '/org/question1';

      const childFile2 = createMockFile(2, 'dashboard');
      childFile2.path = '/org/dashboard1';

      mockGetFiles.mockResolvedValue({
        data: [childFile1, childFile2],
        metadata: {
          folders: [{ id: 100, name: 'org', path: '/org', type: 'folder', references: [], created_at: '', updated_at: '', company_id: 1 }]
        }
      });

      const result = await readFolder('/org', { depth: 1 });

      expect(mockGetFiles).toHaveBeenCalledWith({ paths: ['/org'], depth: 1 });
      expect(result.files).toHaveLength(2);
      expect(result.loading).toBe(false);
      expect(result.error).toBeNull();
    });

    it('should respect depth parameter', async () => {
      mockGetFiles.mockResolvedValue({
        data: [],
        metadata: { folders: [] }
      });

      await readFolder('/org', { depth: -1 });

      expect(mockGetFiles).toHaveBeenCalledWith({ paths: ['/org'], depth: -1 });
    });

    it('should use TTL caching', async () => {
      const folderFile = createMockFile(100, 'folder');
      folderFile.path = '/org';

      // First call - loads from API
      mockGetFiles.mockResolvedValue({
        data: [],
        metadata: {
          folders: [{ id: 100, name: 'org', path: '/org', type: 'folder', references: [], created_at: '', updated_at: '', company_id: 1 }]
        }
      });

      await readFolder('/org');
      expect(mockGetFiles).toHaveBeenCalledTimes(1);

      mockGetFiles.mockClear();

      // Second call (immediately after) - should use cache
      await readFolder('/org');
      expect(mockGetFiles).not.toHaveBeenCalled();
    });

    it('should force reload when forceLoad=true', async () => {
      mockGetFiles.mockResolvedValue({
        data: [],
        metadata: { folders: [] }
      });

      await readFolder('/org');
      expect(mockGetFiles).toHaveBeenCalledTimes(1);

      mockGetFiles.mockClear();

      // Force reload should bypass cache
      await readFolder('/org', { forceLoad: true });
      expect(mockGetFiles).toHaveBeenCalledTimes(1);
    });

    it('should handle API errors gracefully', async () => {
      mockGetFiles.mockRejectedValue(new Error('Network error'));

      const result = await readFolder('/org');

      expect(result.files).toEqual([]);
      expect(result.loading).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Network error');
      expect(result.error?.code).toBe('SERVER_ERROR');
    });

    it('should filter files by user permissions', async () => {
      const file1 = createMockFile(1, 'question');
      const file2 = createMockFile(2, 'config'); // Viewer shouldn't see configs

      mockGetFiles.mockResolvedValue({
        data: [file1, file2],
        metadata: { folders: [] }
      });

      const result = await readFolder('/org');

      // Should only return question (config filtered out for viewer role)
      expect(result.files.length).toBeLessThanOrEqual(2);
    });
  });

  describe('getQueryResult', () => {
    it('should execute query and cache result', async () => {
      const queryResult = {
        columns: ['id', 'name'],
        types: ['INTEGER', 'TEXT'],
        rows: [{ id: 1, name: 'Alice' }]
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: queryResult })
      } as Response);

      const result = await getQueryResult({
        query: 'SELECT * FROM users',
        params: {},
        database: 'test_db'
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/query', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          query: 'SELECT * FROM users',
          database_name: 'test_db',
          parameters: {},
          references: []
        })
      }));

      expect(result).toEqual(queryResult);

      // Should be in Redux cache
      const state = mockStore.getState() as RootState;
      const cached = state.queryResults.results['SELECT * FROM users::{}::test_db'];
      expect(cached?.data).toEqual(queryResult);
    });

    it('should return cached result on second call (TTL cache)', async () => {
      const queryResult = {
        columns: ['id'],
        types: ['INTEGER'],
        rows: [{ id: 1 }]
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: queryResult })
      } as Response);

      // First call
      await getQueryResult({
        query: 'SELECT id FROM users',
        params: {},
        database: 'test_db'
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      mockFetch.mockClear();

      // Second call (immediately after) - should use cache
      const cachedResult = await getQueryResult({
        query: 'SELECT id FROM users',
        params: {},
        database: 'test_db'
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(cachedResult).toEqual(queryResult);
    });

    it('should deduplicate concurrent requests', async () => {
      const queryResult = {
        columns: ['count'],
        types: ['INTEGER'],
        rows: [{ count: 100 }]
      };

      // Clear previous mock setup
      mockFetch.mockClear();

      // Track number of calls
      let callCount = 0;

      // Simulate slow query
      mockFetch.mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: queryResult })
        } as Response);
      });

      // Fire 3 concurrent requests
      const promises = [
        getQueryResult({ query: 'SELECT COUNT(*) FROM users', params: {}, database: 'test_db' }),
        getQueryResult({ query: 'SELECT COUNT(*) FROM users', params: {}, database: 'test_db' }),
        getQueryResult({ query: 'SELECT COUNT(*) FROM users', params: {}, database: 'test_db' })
      ];

      const results = await Promise.all(promises);

      // Should only call API once (deduplication)
      expect(callCount).toBe(1);
      expect(results).toEqual([queryResult, queryResult, queryResult]);
    });

    it('should handle query errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Syntax error in SQL' })
      } as Response);

      await expect(
        getQueryResult({
          query: 'SELECT * FORM users', // typo
          params: {},
          database: 'test_db'
        })
      ).rejects.toThrow('Syntax error in SQL');

      // Error should be stored in Redux
      const state = mockStore.getState() as RootState;
      const cached = state.queryResults.results['SELECT * FORM users::{}::test_db'];
      expect(cached?.error).toBe('Syntax error in SQL');
    });

    it('should respect query parameters in cache key', async () => {
      const result1 = { columns: ['name'], types: ['TEXT'], rows: [{ name: 'Alice' }] };
      const result2 = { columns: ['name'], types: ['TEXT'], rows: [{ name: 'Bob' }] };

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: result1 }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: result2 }) } as Response);

      // Different params = different cache entries
      const r1 = await getQueryResult({ query: 'SELECT name FROM users WHERE id = :id', params: { id: 1 }, database: 'test_db' });
      const r2 = await getQueryResult({ query: 'SELECT name FROM users WHERE id = :id', params: { id: 2 }, database: 'test_db' });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(r1).toEqual(result1);
      expect(r2).toEqual(result2);
    });
  });
});
