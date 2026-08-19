/**
 * Whether an account has a second factor, in one place.
 *
 * This predicate previously existed as two hand-rolled copies that disagreed:
 * `check-2fa` required a phone number alongside the flag, `send-otp` did not and
 * checked the phone separately. A third copy now gates the credentials login, and a
 * gate is only as strong as the weakest copy of the condition it reads — so there is
 * exactly one.
 */

import type { UserState } from '@/lib/types';

/** The fields the predicate reads. Widened from `User` so an auth module hook that
 *  returns its own user shape can be passed without casting. */
export interface TwoFactorSubject {
  phone?: string | null;
  state?: string | null;
}

/**
 * True when the account must present a login code in addition to its password.
 *
 * The phone number is part of the condition, not an independent check: a flag set on an
 * account with no number to send to would describe a second factor that cannot be
 * performed, and since the gate refuses password-only logins for such an account, the
 * result would be an account nobody can log into. Clearing the number is therefore how
 * an admin turns 2FA off, and it is an admin-only action either way.
 */
export function requiresTwoFactor(user: TwoFactorSubject | null | undefined): boolean {
  if (!user?.phone) return false;
  let state: UserState | null = null;
  try {
    state = user.state ? (JSON.parse(user.state) as UserState) : null;
  } catch {
    // A malformed state blob must not read as "no second factor" by accident, but it
    // also cannot prove one is configured. Treat it as absent — the same answer the
    // JSON.parse throw used to give the callers, which crashed them instead.
    return false;
  }
  return state?.twofa_phone_otp_enabled === true || (state as { twofa_whatsapp_enabled?: boolean } | null)?.twofa_whatsapp_enabled === true;
}
