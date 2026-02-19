import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { getFiles, loadFiles, createFile } from '@/lib/data/files.server';
import { FileType } from '@/lib/types';
import { CreateFileInput } from '@/lib/data/types';

/**
 * GET /api/files?paths=...&type=...&depth=...&includeContent=...
 * Get FileInfo list for folder listings
 *
 * Query params:
 * - paths: string[] - Multiple folder paths (e.g., /org, /team)
 * - type: FileType - Filter by file type (optional)
 * - depth: number - 1 = direct children, -1 = all descendants (default: 1)
 * - includeContent: boolean - Include file content (default: false, for performance)
 *
 * Response includes:
 * - data: FileInfo[] or DbFile[] - Children files (with content if includeContent=true)
 * - metadata.folders: FileInfo[] - Folder files themselves (for pathIndex)
 */
export const GET = withAuth(async (
  request: NextRequest,
  user
) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const paths = searchParams.getAll('paths');
    const type = searchParams.get('type') as FileType | null;
    const depth = parseInt(searchParams.get('depth') || '1');
    const includeContent = searchParams.get('includeContent') === 'true';

    const options = {
      paths,
      type: type || undefined,
      depth
    };

    const result = await getFiles(options, user);

    // If includeContent requested, load full files by their IDs
    if (includeContent && result.data.length > 0) {
      const fileIds = result.data.map(f => f.id);
      const fullFilesResult = await loadFiles(fileIds, user);

      return NextResponse.json({
        success: true,
        data: fullFilesResult.data,
        metadata: result.metadata
      });
    }

    return NextResponse.json({
      success: true,
      data: result.data,
      metadata: result.metadata
    });
  } catch (error) {
    return handleApiError(error);
  }
});

/**
 * POST /api/files
 * Create a new file
 *
 * Body: CreateFileInput
 * {
 *   name: string;
 *   path: string;
 *   type: FileType;
 *   content: BaseFileContent;
 *   references?: number[];
 *   options?: {
 *     returnExisting?: boolean;
 *     createPath?: boolean;
 *   }
 * }
 *
 * Response:
 * - data: DbFile - The created file
 */
export const POST = withAuth(async (
  request: NextRequest,
  user
) => {
  try {
    const input: CreateFileInput = await request.json();
    const result = await createFile(input, user);

    return NextResponse.json({
      success: true,
      data: result.data
    });
  } catch (error) {
    return handleApiError(error);
  }
});
