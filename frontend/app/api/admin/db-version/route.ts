/**
 * Admin-only API endpoint for getting database version
 * GET /api/admin/db-version
 *
 * Returns the current database data version for UI validation
 * Used by import UI to validate version compatibility before upload
 * Requires admin role
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { isAdmin } from '@/lib/auth/role-helpers';
import { ApiErrors } from '@/lib/api/api-responses';
import { getDataVersion } from '@/lib/database/config-db';

export const GET = withAuth(async (request, user) => {
  // Check admin permission
  if (!isAdmin(user.role)) {
    return ApiErrors.forbidden('Admin access required');
  }

  try {
    const version = await getDataVersion();
    return NextResponse.json({ version });
  } catch (error: any) {
    console.error('Get version error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
});
