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
