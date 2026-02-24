import { DbFile, FileType, BaseFileMetadata, BaseFileContent } from '@/lib/types';

/**
 * FileInfo: File metadata without content (for efficient folder listings)
 * Extends BaseFileMetadata with computed references field and company_id
 */
export interface FileInfo extends BaseFileMetadata {
  references: number[];  // Computed from content.assets
  company_id: number;     // Multi-tenant isolation
}

/**
 * Result for loadFile operation
 */
export interface LoadFileResult {
  data: DbFile;
  metadata: {
    references: DbFile[];
  };
}

/**
 * Result for loadFiles operation
 */
export interface LoadFilesResult {
  data: DbFile[];
  metadata: {
    references: DbFile[];
  };
}

/**
 * Options for getFiles operation
 */
export interface GetFilesOptions {
  paths?: string[];
  type?: FileType;
  depth?: number;
}

/**
 * Result for getFiles operation
 */
export interface GetFilesResult {
  data: FileInfo[];
  metadata: {
    folders: FileInfo[];
  };
}

/**
 * Result for saveFile operation (Phase 2)
 */
export interface SaveFileResult {
  data: DbFile;  // Updated file from database
}

/**
 * Options for createFile operation
 */
export interface CreateFileOptions {
  createPath?: boolean;      // Create parent directories if they don't exist
  returnExisting?: boolean;  // Return existing file if path already exists (instead of error)
}

/**
 * Input for createFile operation (Phase 2)
 */
export interface CreateFileInput {
  name: string;
  path: string;
  type: FileType;
  content: BaseFileContent;
  references?: number[];  // Phase 6: Client sends pre-extracted references
  options?: CreateFileOptions;  // Optional create options
}

/**
 * Result for createFile operation (Phase 2)
 */
export interface CreateFileResult {
  data: DbFile;  // Newly created file from database
}

/**
 * Options for getTemplate operation
 */
export interface GetTemplateOptions {
  path?: string;           // Target folder path (for context files)
  databaseName?: string;   // Pre-populate database name (for questions)
  query?: string;          // Pre-populate SQL query (for questions)
}

/**
 * Result for getTemplate operation
 */
export interface GetTemplateResult {
  content: BaseFileContent;
  fileName: string;
  metadata?: {
    availableDatabases?: string[];  // Hint for dropdowns
  };
}

/**
 * Input for batch create: CreateFileInput + client-side virtualId
 */
export interface BatchCreateInput extends CreateFileInput {
  virtualId: number;  // client-side negative ID
}

/**
 * Result for batch create operation
 */
export interface BatchCreateFileResult {
  data: Array<{ virtualId: number; file: DbFile }>;
}

/**
 * Input for batch save: existing file fields
 */
export interface BatchSaveFileInput {
  id: number;
  name: string;
  path: string;
  content: BaseFileContent;
  references: number[];
}

/**
 * Result for batch save operation
 */
export interface BatchSaveFileResult {
  data: DbFile[];
}
