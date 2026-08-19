/**
 * Failed-password counters — the `login_attempts` table.
 *
 * See the `LOGIN_ATTEMPTS` declaration in `./schema/tables.ts` for why this is keyed on
 * the submitted address and written before the user lookup.
 *
 * State, not memory: `lib/http/with-remote-session-auth.ts` limits per process and says
 * so, which is fine for a capability URL. A login limiter that forgets on restart, and
 * that an attacker can sidestep by spreading requests across instances, would not be a
 * limit at all.
 */
import 'server-only';
import { getModules } from '@/lib/modules/registry';
import { LOGIN_FAILURE_WINDOW_MS, LOGIN_MAX_FAILURES } from '@/lib/auth/auth-constants';

const db = () => getModules().db;

/**
 * Counters are keyed on this, not on the raw input.
 *
 * Lowercased so a caller cannot mint a fresh budget per address by varying case. That
 * is defence in depth today — `UserDB.getByEmail` matches exactly, so a case variant
 * resolves to no user — but it costs nothing and the bypass would be silent if that
 * lookup ever became case-insensitive.
 */
function key(email: string): string {
  return email.trim().toLowerCase();
}

export class LoginAttemptsDB {
  /** True when this address has spent its failures inside the current window. */
  static async isLocked(email: string, now: number): Promise<boolean> {
    const { rows } = await db().exec<{ failures: number }>(
      'SELECT failures FROM login_attempts WHERE email = $1 AND window_started_at > $2',
      [key(email), now - LOGIN_FAILURE_WINDOW_MS],
    );
    return (rows[0]?.failures ?? 0) >= LOGIN_MAX_FAILURES;
  }

  /** Count one failed password check. Returns the failure total for the window. */
  static async recordFailure(email: string, now: number): Promise<number> {
    // One statement, so concurrent failures cannot read the same count and each write
    // back the same increment. A stale window resets to 1 and re-opens rather than
    // continuing to add, which is what keeps the window FIXED: `window_started_at`
    // moves only when a window has actually elapsed, never on each new failure.
    const { rows } = await db().exec<{ failures: number }>(
      `INSERT INTO login_attempts (email, failures, window_started_at)
       VALUES ($1, 1, $2)
       ON CONFLICT ON CONSTRAINT login_attempts_pkey DO UPDATE
         SET failures = CASE WHEN login_attempts.window_started_at > $3
                             THEN login_attempts.failures + 1 ELSE 1 END,
             window_started_at = CASE WHEN login_attempts.window_started_at > $3
                                      THEN login_attempts.window_started_at ELSE $2 END
       RETURNING failures`,
      [key(email), now, now - LOGIN_FAILURE_WINDOW_MS],
    );

    // Opportunistic pruning: rows are only interesting inside their window, and there
    // is no cron in this deployment. Bounded by the same index the lookup uses.
    await db().exec('DELETE FROM login_attempts WHERE window_started_at < $1', [now - LOGIN_FAILURE_WINDOW_MS]);

    return Number(rows[0]?.failures ?? 0);
  }

  /** Forget an address's failures. Called on a successful password check. */
  static async clear(email: string): Promise<void> {
    await db().exec('DELETE FROM login_attempts WHERE email = $1', [key(email)]);
  }
}

export { key as loginAttemptKey, LOGIN_FAILURE_WINDOW_MS, LOGIN_MAX_FAILURES };
