/**
 * Generate unique tool call ID matching Python backend format
 * Can be used on both client and server
 */
export function generateUniqueId(): string {
  // Generate random hex string similar to Python's secrets.token_hex(12)
  const randomBytes = Array.from({ length: 12 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
  ).join('');
  return `mxgen_${randomBytes}`;
}
