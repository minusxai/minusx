/**
 * Custom Loader Types
 * Type-specific transformations applied to files after loading from database
 */

import { DbFile } from '@/lib/types';
import { EffectiveUser } from '@/lib/auth/auth-helpers';

/**
 * Options for custom loaders
 */
export interface LoaderOptions {
  refresh?: boolean;  // Force refresh of cached data (e.g., connection schemas)
}

/**
 * CustomLoader: Async function that transforms a file after loading
 * Can enrich, sanitize, or modify file content based on file type
 *
 * Examples:
 * - Config loader: Merge with default values
 * - Connection loader: Add database schema (cached or fresh if refresh=true)
 * - Context loader: Enrich with schema metadata
 *
 * @param file - The file to transform (may have content: null for metadata-only loads)
 * @param user - The effective user (for permission-aware transformations)
 * @param options - Optional loader options (e.g., refresh)
 * @returns Transformed file
 */
export type CustomLoader = (
  file: DbFile,
  user: EffectiveUser,
  options?: LoaderOptions
) => Promise<DbFile>;

/**
 * Default pass-through loader
 * Returns file unchanged
 */
export const defaultLoader: CustomLoader = async (file: DbFile, _user: EffectiveUser, _options?: LoaderOptions) => {
  return file;
};
