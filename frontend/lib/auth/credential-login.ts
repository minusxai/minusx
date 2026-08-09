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
import { LoginAttemptsDB } from '@/lib/database/login-attempts-db';
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
  | { ok: false; reason: 'no-password' | 'bad-password' | 'otp-required' | 'otp-invalid' | 'rate-limited' };

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

/**
 * `evaluateCredentials` plus the failed-password counter — the entry point every login
 * caller uses.
 *
 * The two are separate so the decision stays a pure function with no database, and so
 * the counter cannot be bypassed by reaching for the decision directly: there is one
 * stateful door, and both `authorize()` and `check-2fa` go through it.
 *
 * `email` is taken from the INPUT rather than from `user`, and the caller passes `user`
 * as `null` for an address that does not resolve, so an unknown address is counted and
 * rate-limited exactly like a real one. Counting only resolvable addresses would turn a
 * rate-limited response into a user-existence oracle.
 */
export async function attemptCredentialLogin(
  user: CredentialSubject | null,
  input: CredentialInput,
  now: number = Date.now(),
): Promise<LoginDecision> {
  if (await LoginAttemptsDB.isLocked(input.email, now)) {
    return { ok: false, reason: 'rate-limited' };
  }

  // An address with no user still consumes budget, and answers as a wrong password
  // would. `evaluateCredentials` is never handed a null user, so the shape stays honest.
  const decision = user
    ? await evaluateCredentials(user, input)
    : { ok: false as const, reason: 'bad-password' as const };

  // `otp-required` means the password was RIGHT and only the second factor is missing,
  // so it counts as a success here — otherwise a 2FA user walking the ordinary
  // password → code flow would spend login budget on every sign-in they complete.
  if (decision.ok || decision.reason === 'otp-required') {
    await LoginAttemptsDB.clear(input.email);
  } else if (decision.reason === 'bad-password') {
    // Only a wrong PASSWORD counts. A failed code has its own tighter budget in
    // `auth_codes`; letting it also burn login budget would let a stranger lock an
    // address out through an endpoint that never sees a password.
    await LoginAttemptsDB.recordFailure(input.email, now);
  }

  return decision;
}
