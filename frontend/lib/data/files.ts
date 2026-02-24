import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { IFilesDataLayer } from './files.interface';
import { LoadFileResult, LoadFilesResult, GetFilesOptions, GetFilesResult, SaveFileResult, CreateFileInput, CreateFileResult, GetTemplateOptions, GetTemplateResult, BatchCreateInput, BatchCreateFileResult, BatchSaveFileInput, BatchSaveFileResult } from './types';
import { FileExistsError, AccessPermissionError, FileNotFoundError, SerializedError, deserializeError } from '@/lib/errors';
import { BaseFileContent, FileType } from '@/lib/types';

const API_BASE = '';  // Same origin

/**
 * Client-side implementation of files data layer
 * Uses HTTP calls to API routes
 *
 * Note: user parameter is ignored on client - auth is handled by API routes
 */
class FilesDataLayerClient implements IFilesDataLayer {
  async loadFile(id: number, user?: EffectiveUser, options?: { refresh?: boolean }): Promise<LoadFileResult> {
    const params = new URLSearchParams({ include: 'references' });
    if (options?.refresh) {
      params.set('refresh', 'true');
    }

    const res = await fetch(`${API_BASE}/api/files/${id}?${params.toString()}`);

    if (!res.ok) {
      throw new Error(`Failed to load file ${id}: ${res.statusText}`);
    }

    const json = await res.json();
    return json.data;
  }

  async loadFileByPath(path: string, user?: EffectiveUser): Promise<LoadFileResult> {
    const params = new URLSearchParams({ path });
    const res = await fetch(`${API_BASE}/api/files/by-path?${params.toString()}`);

    if (!res.ok) {
      throw new Error(`Failed to load file at path ${path}: ${res.statusText}`);
    }

    const json = await res.json();
    return json.data;
  }

  async loadFiles(ids: number[], user?: EffectiveUser): Promise<LoadFilesResult> {
    const res = await fetch(`${API_BASE}/api/files/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, include: 'references' })
    });

    if (!res.ok) {
      throw new Error(`Failed to load files: ${res.statusText}`);
    }

    const json = await res.json();
    return json.data;
  }

  async getFiles(options: GetFilesOptions, user?: EffectiveUser): Promise<GetFilesResult> {
    const { paths, type, depth = 1 } = options;

    const params = new URLSearchParams();
    if (paths && paths.length > 0) {
      paths.forEach(path => params.append('paths', path));
    }
    if (type) {
      params.set('type', type);
    }
    params.set('depth', depth.toString());

    const url = `${API_BASE}/api/files?${params.toString()}`;
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`Failed to get files: ${res.statusText}`);
    }

    const json = await res.json();
    return { data: json.data, metadata: json.metadata };
  }

  async createFile(input: CreateFileInput, user?: EffectiveUser): Promise<CreateFileResult> {
    const res = await fetch(`${API_BASE}/api/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));

      // Check if this is a serialized error from the server
      if (errorData.error?.type && errorData.error?.message) {
        throw deserializeError(errorData.error as SerializedError);
      }

      // Fallback: Handle nested error structure from API: { error: { message: "..." } }
      const errorMessage = errorData.error?.message || errorData.message || errorData.error || `Failed to create file: ${res.statusText}`;

      // Make UNIQUE constraint errors user-friendly
      if (errorMessage.includes('UNIQUE constraint failed')) {
        // Extract folder path from full path (e.g., "/org/new-question" -> "/org")
        const folderPath = input.path.substring(0, input.path.lastIndexOf('/')) || '/';
        throw new FileExistsError(input.name, folderPath);
      }

      // Check for permission errors
      if (errorMessage.includes('permission') || errorMessage.includes('access') || errorMessage.includes('home folder')) {
        throw new AccessPermissionError(errorMessage);
      }

      // Internal server error - not user-facing
      throw new Error(errorMessage);
    }

    const json = await res.json();
    return { data: json.data };
  }

  async saveFile(id: number, name: string, path: string, content: BaseFileContent, references: number[], user?: EffectiveUser): Promise<SaveFileResult> {
    const res = await fetch(`${API_BASE}/api/files/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path, content, references })  // Phase 6: Send pre-extracted references
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));

      // Check if this is a serialized error from the server
      if (errorData.error?.type && errorData.error?.message) {
        throw deserializeError(errorData.error as SerializedError);
      }

      // Fallback: Handle nested error structure
      const errorMessage = errorData.error?.message || errorData.message || errorData.error || `Failed to save file ${id}: ${res.statusText}`;

      // Check for file not found
      if (errorMessage.includes('not found')) {
        throw new FileNotFoundError(id);
      }

      // Check for permission errors
      if (errorMessage.includes('permission') || errorMessage.includes('access') || errorMessage.includes('home folder')) {
        throw new AccessPermissionError(errorMessage);
      }

      throw new Error(errorMessage);
    }

    const json = await res.json();
    // API now returns { success: true, data: DbFile }
    // Return in SaveFileResult format
    return { data: json.data };
  }

  async getTemplate(type: FileType, options: GetTemplateOptions, user?: EffectiveUser): Promise<GetTemplateResult> {
    const res = await fetch(`${API_BASE}/api/files/template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, options })
    });

    if (!res.ok) {
      throw new Error(`Failed to get template for type ${type}: ${res.statusText}`);
    }

    const json = await res.json();
    return json.data;
  }

  async batchCreateFiles(inputs: BatchCreateInput[], user?: EffectiveUser): Promise<BatchCreateFileResult> {
    const res = await fetch(`${API_BASE}/api/files/batch-create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: inputs })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const errorMessage = errorData.error?.message || errorData.message || errorData.error || `Failed to batch create files: ${res.statusText}`;
      throw new Error(errorMessage);
    }

    const json = await res.json();
    return { data: json.data };
  }

  async batchSaveFiles(inputs: BatchSaveFileInput[], user?: EffectiveUser): Promise<BatchSaveFileResult> {
    const res = await fetch(`${API_BASE}/api/files/batch-save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: inputs })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const errorMessage = errorData.error?.message || errorData.message || errorData.error || `Failed to batch save files: ${res.statusText}`;
      throw new Error(errorMessage);
    }

    const json = await res.json();
    return { data: json.data };
  }

}

// Export singleton instance - PREFER using this
export const FilesAPI = new FilesDataLayerClient();

// Deprecated: Export individual functions for backward compatibility
// TODO Phase 3: Remove these and use FilesAPI namespace everywhere
export const loadFile = FilesAPI.loadFile.bind(FilesAPI);
export const loadFiles = FilesAPI.loadFiles.bind(FilesAPI);
export const getFiles = FilesAPI.getFiles.bind(FilesAPI);
export const createFile = FilesAPI.createFile.bind(FilesAPI);
export const saveFile = FilesAPI.saveFile.bind(FilesAPI);
export const getTemplate = FilesAPI.getTemplate.bind(FilesAPI);
