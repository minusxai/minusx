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
  // Phase 6: For document types, return cached references from DB column. Stories included:
  // a story's saved <Question id>/<Number id> embeds are stored in its references column, and
  // without this the load path resolves NO references — so the agent never sees the referenced
  // queries' results (only the body's inline embeds run).
  if (
    file.type === 'dashboard' ||
    file.type === 'notebook' ||
    file.type === 'question' ||
    file.type === 'story'
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
