/**
 * POST /api/auth/check-2fa
 * Tell the login form which flow to render for these credentials.
 *
 * Advisory only — it enforces nothing, and a client that skips it gains nothing, because
 * `attemptCredentialLogin` decides every login from the same predicate.
 *
 * It verifies the password rather than answering from the address alone: without that
 * it would report any account's 2FA status to a stranger. That makes it a password
 * oracle, which is why it runs through `attemptCredentialLogin` — the same door, and
 * therefore the same failed-password counter, as the credentials callback. Throttling
 * only this route would have moved the question rather than answered it.
 */

import { NextRequest } from 'next/server';
import { UserDB } from '@/lib/database/user-db';
import { attemptCredentialLogin } from '@/lib/auth/credential-login';
import { successResponse, ApiErrors, handleApiError } from '@/lib/http/api-responses';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body as { email?: string; password?: string };

    if (!email || !password) {
      return ApiErrors.badRequest('Email and password are required');
    }

    const user = await UserDB.getByEmail(email);
    const decision = await attemptCredentialLogin(user, { email, password });

    // `otp-required` is the interesting case, not an error: it is returned only after
    // the password has been accepted, and means the account owes a second factor.
    if (decision.ok) return successResponse({ requires2FA: false, email });
    if (decision.reason === 'otp-required') return successResponse({ requires2FA: true, email });

    // Both messages are shown to the user verbatim by the login form, so they are
    // written for a person rather than for a log. They must also stay
    // indistinguishable across "no such account" and "wrong password" — the shared
    // counter is what makes the rate-limited case safe to name.
    return decision.reason === 'rate-limited'
      ? ApiErrors.tooManyRequests('Too many failed sign-in attempts. Please try again later.')
      : ApiErrors.unauthorized('Invalid email or password');
  } catch (error) {
    return handleApiError(error);
  }
}
