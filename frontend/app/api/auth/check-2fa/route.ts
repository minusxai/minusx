/**
 * POST /api/auth/check-2fa
 * Check if a user requires 2FA before attempting login
 * This allows the login UI to show OTP flow when needed
 */

import { NextRequest } from 'next/server';
import { UserDB } from '@/lib/database/user-db';
import { verifyPassword } from '@/lib/auth/password-utils';
import { UserState } from '@/lib/types';
import { successResponse, ApiErrors, handleApiError } from '@/lib/api/api-responses';
import { IS_DEV } from '@/lib/constants';
import { isAdmin } from '@/lib/auth/role-helpers';
import { ADMIN_PWD } from '@/lib/config';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return ApiErrors.badRequest('Email and password are required');
    }

    const user = await UserDB.getByEmail(email);
    if (!user) {
      return ApiErrors.unauthorized('Invalid credentials');
    }

    let passwordValid = false;
    if (IS_DEV && password === user.email) {
      passwordValid = true;
    } else if (isAdmin(user.role) && ADMIN_PWD && password === ADMIN_PWD) {
      passwordValid = true;
    } else if (user.password_hash) {
      passwordValid = await verifyPassword(password, user.password_hash);
    }

    if (!passwordValid) {
      return ApiErrors.unauthorized('Invalid credentials');
    }

    const userState: UserState | null = user.state ? JSON.parse(user.state) : null;
    const requires2FA = user.phone && (userState?.twofa_phone_otp_enabled === true || (userState as any)?.twofa_whatsapp_enabled === true);

    return successResponse({ requires2FA, email: user.email });
  } catch (error) {
    return handleApiError(error);
  }
}
