/**
 * File Search API Route
 *
 * Provides search functionality for files (questions, dashboards)
 * with relevance ranking and pagination
 */

import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { searchFilesInFolder } from '@/lib/search/file-search';
import { FileType } from '@/lib/types';

/**
 * POST /api/files/search
 *
 * Search files by content with ranking and snippets
 *
 * Request body:
 * - query: string (required) - Search query
 * - file_types?: FileType[] - File types to search (default: ['question', 'dashboard'])
 * - folder_path?: string - Folder to search in (default: user's home folder)
 * - depth?: number - Folder depth to search (default: 999)
 * - limit?: number - Results per page (default: 20)
 * - offset?: number - Pagination offset (default: 0)
 *
 * Response:
 * - results: SearchResultMetadata[] - Ranked search results
 * - total: number - Total number of results
 * - query: string - The search query
 * - folder_path: string - The folder that was searched
 * - pagination: { limit, offset, hasMore }
 */
export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const user = await getEffectiveUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const {
      query,
      file_types,
      folder_path,
      depth,
      limit,
      offset
    } = body;

    // Validate required parameters
    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'query is required and must be a string' },
        { status: 400 }
      );
    }

    // Execute search
    const result = await searchFilesInFolder(
      {
        query,
        file_types,
        folder_path,
        depth,
        limit,
        offset
      },
      user
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Search API] Error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
