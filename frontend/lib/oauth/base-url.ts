/**
 * The origin this request arrived on, for building absolute OAuth URLs.
 *
 * Derived from the request rather than configured, so the same image serves an OAuth
 * discovery document that works behind a proxy, through ngrok, on localhost, and on any
 * host the app is reached by — including per-workspace subdomains, where a configured
 * base URL would name the wrong origin and send clients to a discovery document for
 * somebody else's workspace.
 *
 * `x-forwarded-proto` can arrive comma-separated when more than one proxy appends to it
 * (ngrok sends "https, https"); the first hop is the one the client actually spoke.
 */
export function getRequestBaseUrl(request: Request): string {
  const protoHeader = request.headers.get('x-forwarded-proto') || 'http';
  const proto = protoHeader.split(',')[0].trim();
  const host = request.headers.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

/**
 * The RFC 9728 Protected Resource Metadata URL for this origin.
 *
 * `/api/mcp` cites this from its `WWW-Authenticate` challenge so an unauthenticated MCP
 * client can discover the authorization server from the 401 alone.
 */
export function getProtectedResourceMetadataUrl(request: Request): string {
  return `${getRequestBaseUrl(request)}/.well-known/oauth-protected-resource`;
}
