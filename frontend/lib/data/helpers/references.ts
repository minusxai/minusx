import { DbFile, DocumentContent, isFileReference } from '@/lib/types';
import { DocumentDB } from '@/lib/database/documents-db';

/**
 * Extract reference IDs from a file (Phase 6: Reads from cached references column)
 * For dashboards, presentations, notebooks, reports, questions - return cached references from DB
 * For folders - extract IDs of direct children (files whose path starts with folder path)
 */
export async function extractReferenceIds(file: DbFile): Promise<number[]> {
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
    const companyId = file.company_id!;  // Always present in DB queries (NOT NULL column)

    // Use optimized path filtering with depth=1 for direct children only
    // Phase 6: Pass includeContent: false for performance (only need IDs)
    const children = await DocumentDB.listAll(companyId, undefined, [folderPath], 1, false);

    // Filter out the folder itself
    return children.filter(f => f.id !== file.id).map(f => f.id);
  }

  return [];
}

/**
 * Extract all unique reference IDs from multiple files
 */
export async function extractAllReferenceIds(files: DbFile[]): Promise<number[]> {
  const allRefIdsArrays = await Promise.all(files.map(file => extractReferenceIds(file)));
  const allRefIds = allRefIdsArrays.flat();
  return [...new Set(allRefIds)];
}
