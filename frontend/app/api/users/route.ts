import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { UserDB } from '@/lib/database/user-db';
import { CompanyDB } from '@/lib/database/company-db';
import { hashPassword } from '@/lib/auth/password-utils';
import { successResponse, ApiErrors, handleApiError } from '@/lib/api/api-responses';
import { isAdmin } from '@/lib/auth/role-helpers';

/**
 * GET /api/users
 * List all users (admin only) or get current user info (all authenticated users)
 */
export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await auth();

    if (!session?.user) {
      return ApiErrors.unauthorized();
    }

    const userRole = session.user.role || 'viewer';
    const companyId = session.user.companyId;

    if (!companyId) {
      return ApiErrors.forbidden('User does not have a company assigned');
    }

    // Get users from database
    let users;
    if (isAdmin(userRole)) {
      // Admin: return all users in their company
      users = await UserDB.listByCompany(companyId);
    } else {
      // Non-admin: return only current user
      const currentUser = session.user.userId ? await UserDB.getById(session.user.userId, companyId) : null;
      users = currentUser ? [currentUser] : [];
    }

    // Get company name for response
    const company = await CompanyDB.getById(companyId);

    // Map to safe response format (exclude password_hash)
    const safeUsers = users.map(user => ({
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      state: user.state,
      role: user.role,
      home_folder: user.home_folder,
      companyId: user.company_id,
      companyName: company?.name,
    }));

    return successResponse({ users: safeUsers });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/users
 * Create a new user (admin only)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.role || !isAdmin(session.user.role)) {
      return ApiErrors.forbidden();
    }

    const companyId = session.user.companyId;

    if (!companyId) {
      return ApiErrors.forbidden('User does not have a company assigned');
    }

    const body = await request.json();

    // Validate required fields
    if (!body.email || !body.name) {
      return ApiErrors.badRequest('Email and name are required');
    }

    // home_folder: admins will get "" (mode root, enforced in UserDB.create), non-admins need relative folder
    // Default to '' (mode root) if not provided
    const home_folder = body.home_folder ?? '';

    // Check if user already exists in this company
    if (await UserDB.emailExists(body.email, companyId)) {
      return ApiErrors.badRequest('User with this email already exists in this company');
    }

    // Hash password if provided
    let password_hash: string | undefined;
    if (body.password) {
      password_hash = await hashPassword(body.password);
    }

    // Create user
    const userId = await UserDB.create(
      body.email,
      body.name,
      companyId,
      home_folder,
      {
        password_hash,
        phone: body.phone || undefined,
        state: body.state || undefined,
        role: body.role || 'viewer',
      }
    );

    // Get created user
    const newUser = await UserDB.getById(userId, companyId);

    if (!newUser) {
      return ApiErrors.internalError('Failed to create user');
    }

    // Get company name for response
    const company = await CompanyDB.getById(companyId);

    // Return created user without password_hash
    const safeUser = {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      phone: newUser.phone,
      state: newUser.state,
      role: newUser.role,
      home_folder: newUser.home_folder,
      companyId: newUser.company_id,
      companyName: company?.name,
    };

    return successResponse({ user: safeUser }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
