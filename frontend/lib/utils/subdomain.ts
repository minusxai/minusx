/**
 * Extract subdomain from hostname
 *
 * Examples:
 *   - acme.example.com → "acme"
 *   - acme.localhost:3000 → "acme"
 *   - localhost:3000 → null
 *   - example.com → null
 *   - www.example.com → null (www is ignored)
 */
export function extractSubdomain(hostname: string): string | null {
  // Remove port if present
  const host = hostname.split(':')[0];

  // Split by dots
  const parts = host.split('.');

  // localhost with subdomain: acme.localhost
  if (parts.length === 2 && parts[1] === 'localhost') {
    return parts[0];
  }

  // Standard domain with subdomain: acme.example.com
  // Need at least 3 parts (subdomain.domain.tld)
  if (parts.length >= 3) {
    const subdomain = parts[0];
    // Ignore 'www' subdomain
    if (subdomain === 'www') {
      return null;
    }
    return subdomain;
  }

  // No subdomain (localhost, example.com, etc.)
  return null;
}

/**
 * Check if subdomain routing is enabled
 */
export function isSubdomainRoutingEnabled(): boolean {
  // Only enable subdomain routing in multi-tenant mode
  return process.env.ALLOW_MULTIPLE_COMPANIES === 'true';
}
