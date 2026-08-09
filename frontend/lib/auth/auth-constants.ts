/**
 * Authentication constants shared across server and client
 * Single source of truth for auth configuration
 */

/**
 * Current token version
 * Increment this number to force all users to re-authenticate
 * When incremented, all tokens with lower versions will be rejected
 */
export const CURRENT_TOKEN_VERSION = 2;

/**
 * Login-code (OTP) policy.
 *
 * A six-digit code is 10^6 wide, which is only a secret while the number of guesses is
 * bounded. `OTP_MAX_ATTEMPTS` is that bound and it is per ISSUED CODE, which is why
 * `AuthCodesDB.issue` invalidates an email's outstanding codes before inserting a new
 * one: without that, the real budget would be attempts × sends and would compound with
 * every re-send. The send throttle then bounds how fast new budget can be minted.
 */
export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
/** Window and ceiling for how many codes one address may have sent to it. */
export const OTP_SEND_WINDOW_MS = 15 * 60 * 1000;
export const OTP_MAX_SENDS_PER_WINDOW = 5;
/**
 * How long a row survives. Must be >= `OTP_SEND_WINDOW_MS`: rows are what the send
 * throttle counts, so pruning them on code expiry (5 min) would hand back send budget
 * two thirds of the way through the window.
 */
export const OTP_RETENTION_MS = OTP_SEND_WINDOW_MS;

/**
 * Failed-password policy.
 *
 * A password is not a six-digit code, so this is not sized against exhaustive search —
 * it is sized against credential stuffing and against the password oracle that any
 * login endpoint inherently is. Ten is comfortably above what a real person typing a
 * forgotten password produces.
 *
 * The tradeoff is stated rather than hidden: because the counter is keyed on the
 * address and `ADMIN_PWD` is checked inside the same gate, someone who knows an
 * admin's address can deny that admin a login for the length of a window, repeatedly.
 * The window is short and self-clearing for that reason, and an operator can lift a
 * lock immediately by deleting the address's row from `login_attempts`.
 */
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
