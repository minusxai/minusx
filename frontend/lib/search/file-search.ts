import { DbFile, FileType } from '@/lib/types';
import { searchInField, type FieldSearchStats } from './file-search-utils';
import { FilesAPI } from '@/lib/data/files.server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { canViewFileInUI } from '@/lib/data/helpers/permissions';

/**
 * Search configuration for different file types
 */
interface SearchFieldConfig {
  field: string;
  weight: number;
  accessor: (file: DbFile) => string | string[];
}

const SEARCH_CONFIGS: Record<string, SearchFieldConfig[]> = {
  question: [
    { field: 'name', weight: 3, accessor: (f) => f.name },
    { field: 'path', weight: 2, accessor: (f) => f.path },
    { field: 'description', weight: 2, accessor: (f) => (f.content as any).description || '' },
    { field: 'query', weight: 1, accessor: (f) => (f.content as any).query || '' }
  ],
  dashboard: [
    { field: 'name', weight: 3, accessor: (f) => f.name },
    { field: 'path', weight: 2, accessor: (f) => f.path },
    { field: 'description', weight: 2, accessor: (f) => (f.content as any).description || '' },
    { field: 'asset_names', weight: 1, accessor: (f) => {
      const assets = (f.content as any).assets || [];
      return assets
        .filter((a: any) => a.type === 'text')
        .map((a: any) => a.content || '')
        .join(' ');
    }}
  ],
  folder: [
    { field: 'name', weight: 3, accessor: (f) => f.name },
    { field: 'path', weight: 2, accessor: (f) => f.path }
  ],
  connection: [
    { field: 'name', weight: 3, accessor: (f) => f.name },
    { field: 'path', weight: 2, accessor: (f) => f.path }
  ],
  context: [
    { field: 'name', weight: 3, accessor: (f) => f.name },
    { field: 'path', weight: 2, accessor: (f) => f.path },
    { field: 'description', weight: 2, accessor: (f) => (f.content as any).description || '' }
  ]
};

/**
 * Match information for a single field
 */
export interface FieldMatch {
  field: string;
  snippet: string;
  matchType: 'exact' | 'partial';
}

/**
 * Search result with relevance metadata
 */
export interface SearchResultMetadata {
  id: number;
  name: string;
  path: string;
  type: FileType;
  created_at: string;
  updated_at: string;
  score: number;
  matchCount: number;
  relevantResults: FieldMatch[];
}

/**
 * Calculate relevance score for a file
 * Score formula: (exactMatches * 10 + wordBoundaryMatches * 5 + partialMatches * 1) * fieldWeight / maxPossible
 * Score is capped at 1.0 for files with many matches
 */
function calculateScore(fieldStats: FieldSearchStats[]): number {
  let totalScore = 0;
  let maxPossible = 0;

  for (const stats of fieldStats) {
    const fieldScore =
      (stats.exactMatches * 10) +
      (stats.wordBoundaryMatches * 5) +
      (stats.partialMatches * 1);

    totalScore += fieldScore * stats.weight;
    maxPossible += 30 * stats.weight; // Max: 10 exact matches * weight
  }

  const score = maxPossible > 0 ? totalScore / maxPossible : 0;

  // Cap score at 1.0 (can exceed if file has many matches)
  return Math.min(score, 1.0);
}

/**
 * Search files with ranking and snippet extraction
 * @param files Array of files to search
 * @param query Search query string
 * @returns Array of search results sorted by relevance
 */
export function searchFiles(
  files: DbFile[],
  query: string
): SearchResultMetadata[] {
  if (!query || query.trim().length === 0) {
    // No query - return all files with score 0
    return files.map(f => ({
      id: f.id,
      name: f.name,
      path: f.path,
      type: f.type,
      created_at: f.created_at,
      updated_at: f.updated_at,
      score: 0,
      matchCount: 0,
      relevantResults: []
    }));
  }

  const results: SearchResultMetadata[] = [];

  for (const file of files) {
    const config = SEARCH_CONFIGS[file.type];
    if (!config) continue; // Skip unsupported types

    const fieldStats: FieldSearchStats[] = [];
    let totalMatches = 0;

    // Search each configured field
    for (const fieldConfig of config) {
      const value = fieldConfig.accessor(file);
      const text = Array.isArray(value) ? value.join(' ') : String(value);

      const stats = searchInField(text, query, fieldConfig.field, fieldConfig.weight);
      fieldStats.push(stats);
      totalMatches += stats.exactMatches + stats.wordBoundaryMatches + stats.partialMatches;
    }

    // Skip files with no matches
    if (totalMatches === 0) continue;

    // Calculate score
    const score = calculateScore(fieldStats);

    // Build relevant results (top matches)
    const relevantResults: FieldMatch[] = [];
    for (const stats of fieldStats) {
      if (stats.snippets.length > 0) {
        const matchType = stats.exactMatches > 0 ? 'exact' : 'partial';
        for (const snippet of stats.snippets.slice(0, 2)) { // Max 2 snippets per field
          relevantResults.push({
            field: stats.field,
            snippet,
            matchType
          });
        }
      }
    }

    results.push({
      id: file.id,
      name: file.name,
      path: file.path,
      type: file.type,
      created_at: file.created_at,
      updated_at: file.updated_at,
      score,
      matchCount: totalMatches,
      relevantResults
    });
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results;
}

/**
 * Search files in a folder with pagination
 * Loads files from the specified folder path and searches them with ranking
 *
 * @param options Search options
 * @param user Effective user for permissions
 * @returns Search results with pagination metadata
 */
export async function searchFilesInFolder(
  options: {
    query: string;
    file_types?: FileType[];
    folder_path?: string;
    depth?: number;
    limit?: number;
    offset?: number;
    visibility?: 'ui' | 'all';  // 'ui' = viewTypes filter (default), 'all' = no viewTypes filter (for LLM)
  },
  user: EffectiveUser
): Promise<{
  results: SearchResultMetadata[];
  total: number;
  query: string;
  folder_path: string;
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}> {
  const {
    query,
    file_types,
    folder_path,
    depth = 999,
    limit = 20,
    offset = 0,
    visibility = 'ui'  // Default to UI visibility (checks viewTypes)
  } = options;

  // Validation
  if (!query || typeof query !== 'string') {
    throw new Error('query is required and must be a string');
  }

  // Use user's home_folder if no folder specified (resolve with mode)
  const resolvedHomeFolder = resolveHomeFolderSync(user.mode, user.home_folder || '');
  const searchPath = folder_path || resolvedHomeFolder;

  // Parse file_types (default to all user-facing file types)
  let types: FileType[] = ['question', 'dashboard', 'folder', 'connection', 'context'];
  if (file_types) {
    types = Array.isArray(file_types) ? file_types : [file_types];
  }

  // Load all files for search
  const allFiles: DbFile[] = [];
  for (const type of types) {
    const { data: typeFiles } = await FilesAPI.getFiles({
      paths: [searchPath],
      type,
      depth
    }, user);

    // Load full content for search
    const fileIds = typeFiles.map((f: any) => f.id);
    if (fileIds.length > 0) {
      const { data: fullFiles } = await FilesAPI.loadFiles(fileIds, user);
      allFiles.push(...fullFiles);
    }
  }

  // Apply visibility filter based on context
  // 'ui' mode: Filter to viewable types only (for UI search, folder browser)
  // 'all' mode: No additional filter (for LLM tools - they need full access)
  const filesToSearch = visibility === 'ui'
    ? allFiles.filter(file => canViewFileInUI(file, user))
    : allFiles;

  // Execute search with ranking
  const rankedResults = searchFiles(filesToSearch, query);

  // Apply pagination
  const paginatedResults = rankedResults.slice(offset, offset + limit);

  return {
    results: paginatedResults,
    total: rankedResults.length,
    query,
    folder_path: searchPath,
    pagination: {
      limit,
      offset,
      hasMore: rankedResults.length > offset + limit
    }
  };
}
