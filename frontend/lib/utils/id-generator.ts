/**
 * Generate a unique tool call ID (mxgen_-prefixed hex).
 * Can be used on both client and server
 */
export function generateUniqueId(): string {
  // Generate a random 24-char hex string (12 bytes)
  const randomBytes = Array.from({ length: 12 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
  ).join('');
  return `mxgen_${randomBytes}`;
}
