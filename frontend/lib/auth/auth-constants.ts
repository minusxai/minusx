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
 * Token refresh threshold in seconds
 * Tokens older than this will be automatically refreshed
 */
export const TOKEN_REFRESH_THRESHOLD = 60 * 60; // 1 hour
