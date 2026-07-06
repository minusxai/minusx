import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/http/api-responses';
import { withAuth } from '@/lib/http/with-auth';
import { migrateConversationsToV3 } from '@/lib/data/migrate-conversations-v3.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/migrate-conversations-v3[?dry=1]
 * Admin-only. Ports conversation files → v3 tables in-process (so it works while the dev server holds
 * the single PGLite connection). Idempotent — safe to re-run; source files are left intact.
 */
export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    if (user.role !== 'admin') return ApiErrors.forbidden('admin only');
    const dry = request.nextUrl.searchParams.get('dry') === '1';
    const report = await migrateConversationsToV3({ dry });
    return successResponse(report);
  } catch (error) {
    return handleApiError(error);
  }
});
