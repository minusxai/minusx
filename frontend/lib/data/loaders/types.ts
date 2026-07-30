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
  refresh?: boolean;            // Force refresh of cached data and WAIT for it (user-initiated)
  backgroundRefresh?: boolean;  // Serve cached data now, refresh behind the scenes (e.g. post-save)
  /**
   * Skip expensive/fallible enrichment and serve the raw DB content.
   * Used by callers that only need stored fields (e.g. file search): the context
   * loader's fullSchema computation (which THROWS on unmigrated contexts), the
   * connection loader's schema introspection (which can block for minutes), and
   * the story loader's CSS recompile are all skipped. Sanitization that must
   * never be skipped (connection secret redaction) still runs.
   */
  skipEnrichment?: boolean;
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
