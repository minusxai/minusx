/**
 * Login codes (OTP) — the `auth_codes` table.
 *
 * See the `AUTH_CODES` declaration in `./schema/tables.ts` for why the code digest is
 * held here rather than in a token handed to the client.
 *
 * The module is deliberately deep: `verify` performs claim → compare → consume as one
 * operation rather than exposing the three steps. The ordering is a correctness
 * property — the attempt must be counted BEFORE the comparison, and committed whether
 * or not the comparison succeeds, or a client that hangs up mid-request guesses for
 * free. A caller composing three exported primitives would have to re-derive that.
 */
import 'server-only';
import crypto from 'crypto';
import { getModules } from '@/lib/modules/registry';
import { hashOTP, codeMatchesHash } from '@/lib/auth/otp-utils';
import {
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_WINDOW,
  OTP_RETENTION_MS,
  OTP_SEND_WINDOW_MS,
  OTP_TTL_MS,
} from '@/lib/auth/auth-constants';

export type OtpChannel = 'email' | 'phone';

export type IssueResult =
  | { handle: string }
  | { throttled: true };

export type VerifyResult =
  | { ok: true; email: string; channel: OtpChannel }
  /**
   * `invalid` merges unknown handle, expired, already-consumed and wrong code on
   * purpose — telling them apart tells an attacker which of those states they reached.
   * `exhausted` is separate because it is the caller's OWN attempt count, which they can
   * already derive, and because "request a new code" is the only useful thing to say.
   */
  | { ok: false; reason: 'invalid' | 'exhausted' };

interface AuthCodeRow {
  handle: string;
  email: string;
  code_hash: string;
  channel: OtpChannel;
  attempts: number;
  consumed_at: string | number | null;
  expires_at: string | number;
  created_at: string | number;
}

const db = () => getModules().db;

/** 32 random bytes, hex. Unguessable, and carries nothing derived from the code. */
function newHandle(): string {
  return crypto.randomBytes(32).toString('hex');
}

export class AuthCodesDB {
  /**
   * Record a freshly generated code and return the handle the client will present.
   *
   * `code: null` issues a DECOY — a row with a digest no six-digit code can produce.
   * `send-otp` uses it for an address that is unknown or ineligible, so that the
   * response shape and the throttle accounting are identical either way. A decoy
   * deliberately does NOT invalidate the address's live codes: an attacker who can name
   * an address must not be able to cancel that person's real in-flight login code.
   */
  static async issue(input: {
    email: string;
    channel: OtpChannel;
    code: string | null;
    now: number;
  }): Promise<IssueResult> {
    const { email, channel, code, now } = input;

    // Prune on the RETENTION clock, not the code's expiry — see AUTH_CODES.
    await db().exec('DELETE FROM auth_codes WHERE created_at < $1', [now - OTP_RETENTION_MS]);

    const { rows } = await db().exec<{ n: string | number }>(
      'SELECT COUNT(*) AS n FROM auth_codes WHERE email = $1 AND created_at > $2',
      [email, now - OTP_SEND_WINDOW_MS],
    );
    if (Number(rows[0]?.n ?? 0) >= OTP_MAX_SENDS_PER_WINDOW) return { throttled: true };

    if (code !== null) {
      // One live code per address. Without this the guessing budget would be
      // OTP_MAX_ATTEMPTS × sends, compounding with every re-send. Not scoped by channel:
      // a phone code and an email code are two live codes for one account, which is two
      // budgets. Scoped by address, so this cannot cancel anyone else's login.
      await db().exec(
        'UPDATE auth_codes SET consumed_at = $2 WHERE email = $1 AND consumed_at IS NULL',
        [email, now],
      );
    }

    const handle = newHandle();
    await db().exec(
      `INSERT INTO auth_codes (handle, email, code_hash, channel, attempts, expires_at, created_at)
       VALUES ($1, $2, $3, $4, 0, $5, $6)`,
      [
        handle,
        email,
        // A decoy's digest is 32 random bytes: no SHA-256 of a six-digit string can
        // equal it, so the row verifies like a real one that is simply never guessed.
        code === null ? crypto.randomBytes(32).toString('hex') : hashOTP(code),
        channel,
        now + OTP_TTL_MS,
        now,
      ],
    );
    return { handle };
  }

  /**
   * Count an attempt against `handle` and report whether `code` matched.
   *
   * Success consumes the row, so a correct code is single-use — the predecessor design
   * documented its own inability to do this ("nothing tracks spent nonces, so a token
   * stays replayable until its 5-minute exp").
   */
  static async verify(handle: string, code: string, now: number): Promise<VerifyResult> {
    if (!handle) return { ok: false, reason: 'invalid' };

    // One statement claims the attempt: it increments and returns the row only if the
    // row is live and under the cap. Doing this as SELECT-then-UPDATE would let N
    // concurrent guesses all read the same count and each spend one slot's worth of
    // budget — the cap would hold in the row and not in reality.
    const claimed = await db().exec<AuthCodeRow>(
      `UPDATE auth_codes
          SET attempts = attempts + 1
        WHERE handle = $1
          AND consumed_at IS NULL
          AND expires_at > $2
          AND attempts < $3
      RETURNING *`,
      [handle, now, OTP_MAX_ATTEMPTS],
    );

    const row = claimed.rows[0];
    if (!row) {
      // No row claimed: unknown handle, expired, already consumed, or out of budget.
      // Only the last is worth distinguishing, and only to say "get a new code".
      const existing = await db().exec<{ attempts: number }>(
        'SELECT attempts FROM auth_codes WHERE handle = $1',
        [handle],
      );
      const attempts = existing.rows[0]?.attempts;
      return attempts !== undefined && attempts >= OTP_MAX_ATTEMPTS
        ? { ok: false, reason: 'exhausted' }
        : { ok: false, reason: 'invalid' };
    }

    if (!codeMatchesHash(code, row.code_hash)) return { ok: false, reason: 'invalid' };

    // Spend the code. Guarded on `consumed_at IS NULL` so two concurrent correct
    // submissions yield exactly one verified login rather than two.
    const consumed = await db().exec<{ handle: string }>(
      'UPDATE auth_codes SET consumed_at = $2 WHERE handle = $1 AND consumed_at IS NULL RETURNING handle',
      [handle, now],
    );
    if (!consumed.rows[0]) return { ok: false, reason: 'invalid' };

    return { ok: true, email: row.email, channel: row.channel };
  }
}
