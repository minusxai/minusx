import { EffectiveUser } from '@/lib/auth/auth-helpers';
import { LoadFileResult, LoadFilesResult, GetFilesOptions, GetFilesResult, SaveFileResult, CreateFileInput, CreateFileResult, GetTemplateOptions, GetTemplateResult, BatchCreateInput, BatchCreateFileResult, BatchSaveFileInput, BatchSaveFileResult } from './types';
import { BaseFileContent, FileType } from '@/lib/types';
import { LoaderOptions } from './loaders/types';

/**
 * Shared interface for files data layer
 * Both server and client implementations must conform to this interface
 *
 * Server: Direct database access with auth checks
 * Client: HTTP calls to API routes
 */
export interface IFilesDataLayer {
  /**
   * Load a single file by ID with all its references
   * @param options - Optional loader options (e.g., refresh for connections)
   */
  loadFile(id: number, user: EffectiveUser, options?: LoaderOptions): Promise<LoadFileResult>;

  /**
   * Load a single file by path (without references)
   * Useful for loading files when you only know the path (e.g., LLM call files)
   * @param options - Optional loader options (e.g., refresh for connections)
   */
  loadFileByPath(path: string, user: EffectiveUser, options?: LoaderOptions): Promise<LoadFileResult>;

  /**
   * Load multiple files by IDs with all their references
   * @param options - Optional loader options (e.g., refresh for connections)
   */
  loadFiles(ids: number[], user: EffectiveUser, options?: LoaderOptions): Promise<LoadFilesResult>;

  /**
   * Get FileInfo list (without content) for efficient folder listings
   */
  getFiles(options: GetFilesOptions, user: EffectiveUser): Promise<GetFilesResult>;

  /**
   * Create new file (Phase 2)
   * Creates file in database and returns newly created file
   */
  createFile(input: CreateFileInput, user: EffectiveUser): Promise<CreateFileResult>;

  /**
   * Save file content (Phase 2)
   * Updates file content, name, and path in database and returns updated file
   * @param name - File name (from file.name metadata, not content)
   * @param path - File path (reconstructed with slugified name in useFile)
   */
  saveFile(id: number, name: string, path: string, content: BaseFileContent, references: number[], user: EffectiveUser): Promise<SaveFileResult>;

  /**
   * Get pre-populated file template for a given file type
   * Returns content structure with default values for new file creation
   */
  getTemplate(type: FileType, options: GetTemplateOptions, user: EffectiveUser): Promise<GetTemplateResult>;

  /**
   * Batch-create multiple virtual files in a single operation.
   * Each input includes the client-side virtualId so the caller can build an idMap.
   */
  batchCreateFiles(inputs: BatchCreateInput[], user: EffectiveUser): Promise<BatchCreateFileResult>;

  /**
   * Batch-save multiple existing files in a single operation.
   */
  batchSaveFiles(inputs: BatchSaveFileInput[], user: EffectiveUser): Promise<BatchSaveFileResult>;

}
