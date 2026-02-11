/**
 * Loader Registry
 * Maps file types to their custom loader functions
 */

import { FileType } from '@/lib/types';
import { CustomLoader, defaultLoader } from './types';
import { configLoader } from './config-loader';
import { connectionLoader } from './connection-loader';
import { contextLoader } from './context-loader';

/**
 * Loader registry: Maps file types to custom loader functions
 * Types not in registry use defaultLoader (pass-through)
 */
type LoaderRegistry = Partial<Record<FileType, CustomLoader>>;

const registry: LoaderRegistry = {
  config: configLoader,
  connection: connectionLoader,
  context: contextLoader,
  // All other types use defaultLoader (pass-through)
};

/**
 * Get the appropriate loader for a file type
 * Returns defaultLoader (pass-through) for types without custom loaders
 */
export function getLoader(fileType: FileType): CustomLoader {
  return registry[fileType] || defaultLoader;
}
