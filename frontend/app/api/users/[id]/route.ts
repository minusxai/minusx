import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { UserDB } from '@/lib/database/user-db';
import { hashPassword } from '@/lib/auth/password-utils';
import { successResponse, ApiErrors, handleApiError } from '@/lib/api/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/users/[id]
 * Get a single user by ID (admin only or own user)
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();

    if (!session?.user) {
      return ApiErrors.unauthorized();
    }

    const resolvedParams = await params;
    const userId = parseInt(resolvedParams.id, 10);
    if (isNaN(userId)) {
      return ApiErrors.badRequest('Invalid user ID');
    }

    // Check authorization
    const userRole = session.user.role || 'viewer';
    const isOwnUser = session.user.userId === userId;
    const companyId = session.user.companyId;

    if (!companyId) {
      return ApiErrors.forbidden('Company ID not found in session');
    }

    if (!isAdmin(userRole) && !isOwnUser) {
      return ApiErrors.forbidden();
    }

    const user = await UserDB.getById(userId, companyId);

    if (!user) {
      return ApiErrors.notFound('User');
    }

    // Return user without password_hash
    const safeUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      home_folder: user.home_folder,
    };

    return successResponse({ user: safeUser });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PUT /api/users/[id]
 * Update a user (admin only or own user)
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();

    if (!session?.user) {
      return ApiErrors.unauthorized();
    }

    const resolvedParams = await params;
    const userId = parseInt(resolvedParams.id, 10);
    if (isNaN(userId)) {
      return ApiErrors.badRequest('Invalid user ID');
    }

    // Check authorization
    const userRole = session.user.role || 'viewer';
    const isOwnUser = session.user.userId === userId;
    const companyId = session.user.companyId;

    if (!companyId) {
      return ApiErrors.forbidden('Company ID not found in session');
    }

    if (!isAdmin(userRole) && !isOwnUser) {
      return ApiErrors.forbidden();
    }

    // Get existing user
    const existingUser = await UserDB.getById(userId, companyId);

    if (!existingUser) {
      return ApiErrors.notFound('User');
    }

    const body = await request.json();

    // Non-admins cannot change role, home_folder, phone, or 2FA state
    if (!isAdmin(userRole)) {
      delete body.role;
      delete body.home_folder;
      delete body.phone;
      delete body.state;
    }

    // Hash password if provided
    if (body.password) {
      body.password_hash = await hashPassword(body.password);
      delete body.password;
    }

    // Update user
    await UserDB.update(userId, companyId, body);

    // Get updated user
    const updatedUser = await UserDB.getById(userId, companyId);

    if (!updatedUser) {
      return ApiErrors.notFound('User');
    }

    // Return updated user without password_hash
    const safeUser = {
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      phone: updatedUser.phone,
      state: updatedUser.state,
      role: updatedUser.role,
      home_folder: updatedUser.home_folder,
    };

    return successResponse({ user: safeUser });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/users/[id]
 * Delete a user (admin only)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();

    if (!session?.user?.role || !isAdmin(session.user.role)) {
      return ApiErrors.forbidden();
    }

    const resolvedParams = await params;
    const userId = parseInt(resolvedParams.id, 10);
    if (isNaN(userId)) {
      return ApiErrors.badRequest('Invalid user ID');
    }

    // Don't allow deleting yourself
    if (session.user.userId === userId) {
      return ApiErrors.badRequest('Cannot delete your own user account');
    }

    const companyId = session.user.companyId;
    if (!companyId) {
      return ApiErrors.forbidden('Company ID not found in session');
    }

    // Get existing user
    const existingUser = await UserDB.getById(userId, companyId);

    if (!existingUser) {
      return ApiErrors.notFound('User');
    }

    await UserDB.delete(userId, companyId);

    return successResponse({ message: 'User deleted successfully' });
  } catch (error) {
    return handleApiError(error);
  }
}
