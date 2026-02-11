import { NextRequest } from 'next/server';
import { successResponse, ApiErrors, handleApiError } from '@/lib/api/api-responses';
import { withAuth } from '@/lib/api/with-auth';
import { AccessTokenDB } from '@/lib/database/documents-db';
import { isAdmin } from '@/lib/auth/role-helpers';

/**
 * DELETE /api/access-tokens/[id]
 * Revoke an access token
 *
 * Params:
 * - id: Token string (UUID)
 *
 * Returns:
 * - success: boolean
 *
 * Auth: Admin only
 */
export const DELETE = withAuth(async (
  request: NextRequest,
  user,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    // Security: Only admins can revoke tokens
    if (!isAdmin(user.role)) {
      return ApiErrors.forbidden('Only admins can revoke access tokens');
    }

    if (!user.companyId) {
      return ApiErrors.badRequest('Company ID is required');
    }

    const resolvedParams = await params;
    const token = resolvedParams.id;  // Token string (UUID)

    if (!token) {
      return ApiErrors.validationError('Token is required');
    }

    // Revoke token (sets is_active = false)
    const success = await AccessTokenDB.revoke(token, user.companyId);

    if (!success) {
      return ApiErrors.notFound('Token');
    }

    return successResponse({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
});

/**
 * PATCH /api/access-tokens/[id]
 * Update token expiration
 *
 * Params:
 * - id: Token string (UUID)
 *
 * Body:
 * - expires_at: string | null (ISO timestamp or null for no expiration)
 *
 * Returns:
 * - success: boolean
 *
 * Auth: Admin only
 */
export const PATCH = withAuth(async (
  request: NextRequest,
  user,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    // Security: Only admins can update tokens
    if (!isAdmin(user.role)) {
      return ApiErrors.forbidden('Only admins can update access tokens');
    }

    if (!user.companyId) {
      return ApiErrors.badRequest('Company ID is required');
    }

    const resolvedParams = await params;
    const token = resolvedParams.id;  // Token string (UUID)

    if (!token) {
      return ApiErrors.validationError('Token is required');
    }

    const body = await request.json();

    // Validate expires_at provided
    if (!('expires_at' in body)) {
      return ApiErrors.validationError('expires_at is required');
    }

    // Update expiration
    const success = await AccessTokenDB.updateExpiration(token, user.companyId, body.expires_at);

    if (!success) {
      return ApiErrors.notFound('Token');
    }

    return successResponse({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
});
