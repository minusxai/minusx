import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import { discardRawGrids } from '@/lib/sheets-import/service.server';
import type { RawGridFile } from '@/lib/sheets-import/types';

// Delete transient raw grids when the user cancels an import/adjust wizard. Prefix-guarded:
// only keys under the connection's own raw prefix are accepted.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body = await request.json().catch(() => ({}));
    const { raw_files, connection_name } = body as { raw_files?: RawGridFile[]; connection_name?: string };
    if (!Array.isArray(raw_files) || raw_files.length === 0) return ApiErrors.badRequest('raw_files is required');
    if (!connection_name) return ApiErrors.badRequest('connection_name is required');

    await discardRawGrids({ rawFiles: raw_files, connectionName: connection_name, user });
    return successResponse({});
  } catch (error) {
    if (error instanceof Error && error.message.includes('outside the connection prefix')) {
      return ApiErrors.badRequest(error.message);
    }
    return handleApiError(error);
  }
});
