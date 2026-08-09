/**
 * Login-code (OTP) primitives.
 *
 * Generation, digesting, and the short-lived token that carries "this address
 * completed a code challenge" from `verify-otp` to the credentials provider. The codes
 * themselves live in `auth_codes` (`lib/database/auth-codes-db.ts`) — nothing here
 * stores state, and nothing here puts a code or its digest into a value the client
 * receives.
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { NEXTAUTH_SECRET } from '@/lib/config';

/**
 * Generate a cryptographically random 6-digit OTP.
 *
 * `crypto.randomInt`, not `Math.random`: this is a login secret, and `Math.random`
 * is a non-cryptographic PRNG whose internal state is recoverable from a modest
 * number of observed outputs — after which every later code is predictable.
 * Samples are easy to obtain, since anyone can request codes for their own
 * account. `randomInt` is uniform over the half-open range, so the upper bound
 * is exclusive.
 */
export function generateOTP(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Digest a code for storage in `auth_codes.code_hash`.
 *
 * Plain SHA-256 is sufficient *because the digest never leaves the server*. The 10^6
 * preimage space means a digest an attacker can see is a digest an attacker has already
 * broken, which is exactly what sank the predecessor design; it is not a reason to
 * reach for a slow KDF here, where the attempt cap — not the hash cost — is what bounds
 * guessing.
 */
export function hashOTP(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

/**
 * Constant-time comparison of a submitted code against a stored digest.
 *
 * Both sides are fixed-length hex digests, so the length guard below only ever fires on
 * a corrupt stored value. Timing was not the weakness in the predecessor design — it
 * compared digests, not secrets — but a comparison that is constant-time by
 * construction removes the question rather than leaving it to be re-argued.
 */
export function codeMatchesHash(submittedOTP: string, otpHash: string): boolean {
  const submitted = Buffer.from(hashOTP(submittedOTP), 'hex');
  const stored = Buffer.from(otpHash, 'hex');
  if (submitted.length !== stored.length) return false;
  return crypto.timingSafeEqual(submitted, stored);
}

/**
 * Proof that an address completed a code challenge — created after a successful
 * verification and spent immediately by `signIn()`.
 *
 * It carries no code and no digest, so it is safe as a stateless JWT; its exposure is
 * the 60-second window in which a caller who can already read the verify response could
 * replay it, and anyone who can read that response can read the session cookie it is
 * about to become.
 */
export interface VerifiedOTPPayload {
  email: string;
  /** Discriminator. `NEXTAUTH_SECRET` also signs the MCP OAuth tokens
   *  (`lib/oauth/db.ts`), so a token's *type* must be asserted rather than inferred
   *  from the presence of a field another type might one day also carry. */
  typ: 'otp_verified';
  verified: true;
  exp: number;
}

const VERIFIED_TOKEN_TTL_SECONDS = 60;

export function createVerifiedToken(email: string): string {
  const secret = NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET is not configured');
  }
  const exp = Math.floor(Date.now() / 1000) + VERIFIED_TOKEN_TTL_SECONDS;
  return jwt.sign({ email, typ: 'otp_verified', verified: true, exp }, secret);
}

/**
 * Verify and decode a verified-OTP token.
 * Returns null if the token is invalid, expired, or not a verified-OTP token.
 */
export function verifyVerifiedToken(token: string): VerifiedOTPPayload | null {
  try {
    const secret = NEXTAUTH_SECRET;
    if (!secret) throw new Error('NEXTAUTH_SECRET is not configured');
    const payload = jwt.verify(token, secret) as Partial<VerifiedOTPPayload>;
    if (payload.typ !== 'otp_verified') return null;
    if (payload.verified !== true) return null;
    if (typeof payload.email !== 'string' || !payload.email) return null;
    return payload as VerifiedOTPPayload;
  } catch {
    return null;
  }
}
