/**
 * The credentials-login decision, extracted from the NextAuth provider.
 *
 * It lives here rather than inline in `authorize()` for two reasons: the rule is app
 * policy rather than anything NextAuth owns, and `authorize` is reachable in a test
 * only through the whole NextAuth handler — so the gate that enforces two-factor would
 * have had no direct test.
 */

import { verifyPassword } from '@/lib/auth/password-utils';
import { verifyVerifiedToken } from '@/lib/auth/otp-utils';
import { requiresTwoFactor, type TwoFactorSubject } from '@/lib/auth/two-factor';
import { isAdmin } from '@/lib/auth/role-helpers';
import { IS_DEV } from '@/lib/constants';
import { ADMIN_PWD } from '@/lib/config';
import type { UserRole } from '@/lib/types';

export interface CredentialSubject extends TwoFactorSubject {
  email: string;
  password_hash?: string | null;
  role?: string | null;
}

export interface CredentialInput {
  email: string;
  password?: unknown;
  otp_verified_token?: unknown;
}

export type LoginDecision =
  | { ok: true }
  | { ok: false; reason: 'no-password' | 'bad-password' | 'otp-required' | 'otp-invalid' };

/** Does the presented token prove a completed code challenge for THIS address? */
function otpProven(input: CredentialInput): boolean {
  if (typeof input.otp_verified_token !== 'string' || !input.otp_verified_token) return false;
  const payload = verifyVerifiedToken(input.otp_verified_token);
  return !!payload && payload.email === input.email;
}

async function passwordAccepted(user: CredentialSubject, password: unknown): Promise<boolean> {
  if (typeof password !== 'string' || !password) return false;
  // Both shortcuts are pre-existing and deliberate; see `frontend/lib/auth/CLAUDE.md`.
  // What matters here is that they sit INSIDE the password branch, so the two-factor
  // gate below applies to them exactly as it does to a real hash check.
  if (IS_DEV && password === user.email) return true;
  if (isAdmin((user.role ?? 'viewer') as UserRole) && ADMIN_PWD && password === ADMIN_PWD) return true;
  if (!user.password_hash) return false;
  return verifyPassword(password, user.password_hash);
}

/**
 * Decide whether a set of credentials logs this user in.
 *
 * Two rules, and the first is the one that was missing:
 *
 * - An account with a second factor needs BOTH — a valid password and a completed code
 *   challenge. Previously the second factor was decided by `check-2fa` and enforced
 *   nowhere: the browser was trusted to run the OTP flow, so posting the password
 *   straight to the credentials provider skipped it. That also means a passwordless
 *   email code cannot log into a 2FA account on its own; one factor is one factor
 *   whichever channel delivered it.
 * - An account without one needs EITHER — its password, or a completed code challenge
 *   (the passwordless email-code login).
 */
export async function evaluateCredentials(
  user: CredentialSubject,
  input: CredentialInput,
): Promise<LoginDecision> {
  const otpOk = otpProven(input);
  const passwordPresented = typeof input.password === 'string' && input.password.length > 0;
  const passwordOk = passwordPresented && await passwordAccepted(user, input.password);

  if (requiresTwoFactor(user)) {
    if (!passwordPresented) return { ok: false, reason: 'no-password' };
    if (!passwordOk) return { ok: false, reason: 'bad-password' };
    return otpOk ? { ok: true } : { ok: false, reason: 'otp-required' };
  }

  if (passwordOk || otpOk) return { ok: true };
  if (passwordPresented) return { ok: false, reason: 'bad-password' };
  if (input.otp_verified_token) return { ok: false, reason: 'otp-invalid' };
  return { ok: false, reason: 'no-password' };
}
