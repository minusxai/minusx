import { NextRequest } from 'next/server';
import { successResponse, ApiErrors, handleApiError } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { AccessTokenDB } from '@/lib/database/documents-db';
import { DocumentDB } from '@/lib/database/documents-db';
import { AccessTokenCreate } from '@/lib/types';
import { isAdmin } from '@/lib/auth/role-helpers';
import { AUTH_URL } from '@/lib/config';

/**
 * POST /api/access-tokens
 * Create a new access token for public file sharing
 *
 * Body:
 * - file_id: number (required)
 * - view_as_user_id: number (required)
 * - expires_at: string (optional, defaults to 30 days from now)
 *
 * Returns:
 * - token: string (UUID)
 * - url: string (full URL to access file)
 *
 * Auth: Admin only
 */
export const POST = withAuth(async (
  request: NextRequest,
  user
) => {
  try {
    // Security: Only admins can create tokens
    if (!isAdmin(user.role)) {
      return ApiErrors.forbidden('Only admins can create access tokens');
    }

    const body: AccessTokenCreate = await request.json();

    // Validate required fields
    if (!body.file_id || !body.view_as_user_id) {
      return ApiErrors.validationError('file_id and view_as_user_id are required');
    }

    // Verify file exists and belongs to same company
    const file = await DocumentDB.getById(body.file_id, user.companyId);
    if (!file) {
      return ApiErrors.notFound('File');
    }

    // Create token
    const token = await AccessTokenDB.create(
      body.file_id,
      body.view_as_user_id,
      user.companyId,
      user.userId, // Admin user creating the token
      body.expires_at
    );

    // Construct public URL
    const url = `${AUTH_URL}/t/${token}`;

    return successResponse({ token, url });
  } catch (error) {
    return handleApiError(error);
  }
});

/**
 * GET /api/access-tokens?fileId={id}
 * List all tokens for a specific file
 *
 * Query params:
 * - fileId: number (required)
 *
 * Returns:
 * - Array of AccessToken objects
 *
 * Auth: Admin only
 */
export const GET = withAuth(async (
  request: NextRequest,
  user
) => {
  try {
    // Security: Only admins can list tokens
    if (!isAdmin(user.role)) {
      return ApiErrors.forbidden('Only admins can list access tokens');
    }

    const fileId = request.nextUrl.searchParams.get('fileId');

    if (!fileId) {
      return ApiErrors.validationError('fileId query parameter is required');
    }

    const tokens = await AccessTokenDB.listByFileId(parseInt(fileId), user.companyId);

    return successResponse(tokens);
  } catch (error) {
    return handleApiError(error);
  }
});
