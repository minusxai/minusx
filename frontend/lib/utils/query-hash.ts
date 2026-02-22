/**
 * Query hash utilities
 * Shared between client and server for consistent query result caching
 */

// cyrb53: fast 53-bit non-cryptographic hash, works sync on client + server
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x9e3779b1);
    h2 = Math.imul(h2 ^ c, 0x243f6af3);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 0x45d9f3b) ^ Math.imul(h2 ^ (h2 >>> 13), 0x45d9f3b);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 0x45d9f3b) ^ Math.imul(h1 ^ (h1 >>> 13), 0x45d9f3b);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Generate a short hash key for query lookup.
 * Used for caching query results in Redux and storing queryResultId in question content.
 */
export function getQueryHash(query: string, params: Record<string, any>, database: string): string {
  return cyrb53(`${database}|||${query}|||${JSON.stringify(params)}`);
}
