import 'server-only';
import { DbFile } from '@/lib/types';

export type ChildIdResolver = (folderPath: string) => Promise<number[]>;

/**
 * Extract reference IDs from a file (Phase 6: Reads from cached references column)
 * For dashboards, presentations, notebooks, reports, questions - return cached references from DB
 * For folders - delegates to resolveChildIds (injected by caller) to avoid circular imports
 *
 * @param resolveChildIds - Required for folder files. Provided by files.server.ts using DocumentDB.
 */
export async function extractReferenceIds(
  file: DbFile,
  resolveChildIds: ChildIdResolver
): Promise<number[]> {
  // Phase 6: For document types, return cached references from DB column
  if (
    file.type === 'dashboard' ||
    file.type === 'presentation' ||
    file.type === 'notebook' ||
    file.type === 'report' ||
    file.type === 'question'
  ) {
    return file.references || [];
  }

  // Handle folders - return IDs of direct children
  if (file.type === 'folder') {
    const folderPath = file.path;

    // Delegate to injected resolver (implemented in files.server.ts using DocumentDB)
    const childIds = await resolveChildIds(folderPath);

    // Filter out the folder itself
    return childIds.filter(id => id !== file.id);
  }

  return [];
}

/**
 * Extract all unique reference IDs from multiple files
 */
export async function extractAllReferenceIds(
  files: DbFile[],
  resolveChildIds: ChildIdResolver
): Promise<number[]> {
  const allRefIdsArrays = await Promise.all(files.map(file => extractReferenceIds(file, resolveChildIds)));
  const allRefIds = allRefIdsArrays.flat();
  return [...new Set(allRefIds)];
}
