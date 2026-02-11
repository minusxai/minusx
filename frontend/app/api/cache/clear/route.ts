import { NextRequest } from 'next/server';
import { successResponse, handleApiError, ApiErrors } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { revalidateTag } from 'next/cache';

/**
 * POST /api/cache/clear
 * Clear all cached data (database schemas)
 * Useful for forcing a full reload of connection schemas
 * Admin only
 */
export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    // Admin only
    if (user.role !== 'admin') {
      return ApiErrors.forbidden('Only admins can clear cache');
    }

    console.log('[Cache] Clearing all caches for admin:', user.email);

    // Clear schema cache
    revalidateTag('database-schema', 'default');

    console.log('[Cache] All caches cleared successfully');

    return successResponse({
      message: 'Cache cleared successfully. Database schemas will be re-introspected on next load.',
      clearedTags: ['database-schema']
    });
  } catch (error) {
    return handleApiError(error);
  }
});
