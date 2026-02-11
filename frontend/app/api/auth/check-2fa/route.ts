/**
 * POST /api/auth/check-2fa
 * Check if a user requires 2FA before attempting login
 * This allows the login UI to show OTP flow when needed
 */

import { NextRequest } from 'next/server';
import { UserDB } from '@/lib/database/user-db';
import { CompanyDB } from '@/lib/database/company-db';
import { verifyPassword } from '@/lib/auth/password-utils';
import { UserState } from '@/lib/types';
import { successResponse, ApiErrors, handleApiError } from '@/lib/api/api-responses';
import { IS_DEV } from '@/lib/constants';
import { isAdmin } from '@/lib/auth/role-helpers';
import { ADMIN_PWD } from '@/lib/config';

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json();
    const { email, password, company: companyName } = body;

    if (!email || !password) {
      return ApiErrors.badRequest('Email and password are required');
    }

    // Find company
    let company;
    if (!companyName) {
      const defaultCompany = await CompanyDB.getDefaultCompany();
      if (!defaultCompany) {
        return ApiErrors.badRequest('Company name required');
      }
      company = defaultCompany;
    } else {
      company = await CompanyDB.getByName(companyName);
      if (!company) {
        return ApiErrors.notFound('Company not found');
      }
    }

    // Look up user
    const user = await UserDB.getByEmailAndCompany(email, company.id);
    if (!user) {
      return ApiErrors.unauthorized('Invalid credentials');
    }

    // Verify password (same logic as authorize())
    let passwordValid = false;

    if (IS_DEV && password === user.email) {
      passwordValid = true;
    } else if (!user.password_hash) {
      if (isAdmin(user.role) && ADMIN_PWD && password === ADMIN_PWD) {
        passwordValid = true;
      }
    } else {
      passwordValid = await verifyPassword(password, user.password_hash);
    }

    if (!passwordValid) {
      return ApiErrors.unauthorized('Invalid credentials');
    }

    // Check if 2FA is required
    const userState: UserState | null = user.state ? JSON.parse(user.state) : null;
    const requires2FA = user.phone && userState?.twofa_whatsapp_enabled === true;

    // Return result
    return successResponse({
      requires2FA,
      email: user.email,
      companyId: company.id,
      companyName: company.name,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
