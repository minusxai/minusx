/**
 * POST /api/auth/check-2fa
 * Check if a user requires 2FA before attempting login
 * This allows the login UI to show OTP flow when needed
 */

import { NextRequest } from 'next/server';
import { UserDB } from '@/lib/database/user-db';
import { verifyPassword } from '@/lib/auth/password-utils';
import { requiresTwoFactor } from '@/lib/auth/two-factor';
import { successResponse, ApiErrors, handleApiError } from '@/lib/http/api-responses';
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

    // Advisory only. This tells the login form which flow to render; it is NOT what
    // enforces the second factor — `evaluateCredentials` is, on every login, from the
    // same predicate. A client that skips this call gains nothing.
    return successResponse({ requires2FA: requiresTwoFactor(user), email: user.email });
  } catch (error) {
    return handleApiError(error);
  }
}
