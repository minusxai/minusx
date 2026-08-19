/**
 * POST /api/auth/verify-otp
 * Check a submitted login code against the handle `send-otp` returned.
 *
 * All the state that makes this safe — the attempt counter, single-use consumption,
 * expiry — lives in `auth_codes`. The route is thin on purpose: counting an attempt
 * before comparing, and consuming on success, are one indivisible operation inside
 * `AuthCodesDB.verify` rather than three steps a caller could reorder.
 */

import { NextRequest } from 'next/server';
import { createVerifiedToken } from '@/lib/auth/otp-utils';
import { requiresTwoFactor } from '@/lib/auth/two-factor';
import { UserDB } from '@/lib/database/user-db';
import { AuthCodesDB } from '@/lib/database/auth-codes-db';
import { successResponse, ApiErrors, handleApiError } from '@/lib/http/api-responses';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, otp } = body as { token?: string; otp?: string };

    if (!token || !otp) {
      return ApiErrors.badRequest('Token and OTP are required');
    }

    const result = await AuthCodesDB.verify(token, otp, Date.now());

    if (!result.ok) {
      // `exhausted` is the caller's own attempt count, which they can already derive, and
      // "request a new code" is the only useful thing to say. Everything else — unknown
      // handle, expired, already used, simply wrong — answers identically, so a guess
      // cannot be used to learn which of those states it reached.
      return result.reason === 'exhausted'
        ? ApiErrors.tooManyRequests('Too many incorrect attempts. Please request a new code.')
        : ApiErrors.unauthorized('Invalid or expired code');
    }

    // A code is ONE factor. For a 2FA account the sign-in will require a password
    // alongside it, and the caller has to be told so — otherwise the passwordless entry
    // point dead-ends on a correct code with a generic failure and no way forward. This
    // is only disclosed to someone who has just proven control of the address, who could
    // learn the same thing by simply attempting to log in.
    const user = await UserDB.getByEmail(result.email);

    return successResponse({
      success: true,
      email: result.email,
      passwordRequired: requiresTwoFactor(user),
      // Spent by signIn(); carries no code and no digest.
      verifiedToken: createVerifiedToken(result.email),
      message: 'OTP verified successfully',
    });
  } catch (error) {
    return handleApiError(error);
  }
}
