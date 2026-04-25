import { NextRequest, NextResponse } from 'next/server';
import { handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { batchSaveFiles } from '@/lib/data/files.server';
import { BatchSaveFileInput } from '@/lib/data/types';

/**
 * POST /api/files/batch-save
 * Save multiple existing files in a single round trip.
 *
 * Body: { files: BatchSaveFileInput[], dryRun?: boolean }
 *
 * Response (dryRun: false): { data: DbFile[] }
 * Response (dryRun: true):  { success: boolean, errors: Array<{id, error}> }
 */
export const POST = withAuth(async (
  request: NextRequest,
  user
) => {
  try {
    const body = await request.json();
    const { files, dryRun = false } = body;

    if (!Array.isArray(files) || files.length === 0) {
      return ApiErrors.validationError('files must be a non-empty array');
    }

    const inputs = files as BatchSaveFileInput[];

    if (dryRun) {
      const result = await batchSaveFiles(inputs, user, true);
      return NextResponse.json(result);
    }

    const result = await batchSaveFiles(inputs, user);
    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    return handleApiError(error);
  }
});
