/**
 * The `/api/mcp` 401 is a discovery entry point, not just a rejection.
 *
 * RFC 9728 says the challenge cites the Protected Resource Metadata document, and that is the
 * only thread a spec-following MCP client has to pull: 401 → `resource_metadata` →
 * `authorization_servers` → RFC 8414 → dynamic registration → authorize. The header used to be
 * the bare word `Bearer`, so a client had to already know to guess
 * `/.well-known/oauth-protected-resource`; one that follows the spec instead of guessing could
 * not connect at all.
 *
 * These call the real route handler, so they also pin that the URL is derived from the request
 * rather than configured — a workspace reached on its own subdomain must be pointed at its own
 * discovery document, not at some canonical host's.
 */

vi.mock('@/lib/mcp/auth', () => ({
  authenticateOAuthRequest: vi.fn(async () => null),
}));

vi.mock('@/lib/modules/registry', () => ({
  getModules: () => ({
    namespace: {
      resolve: vi.fn(async () => 1),
      with: <T>(_ns: number, fn: () => T) => fn(),
    },
  }),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/mcp/route';

function parseChallenge(header: string): { scheme: string; params: Record<string, string> } {
  const [scheme, ...rest] = header.split(' ');
  const params: Record<string, string> = {};
  for (const part of rest.join(' ').split(',')) {
    const match = part.trim().match(/^([\w-]+)="(.*)"$/);
    if (match) params[match[1]] = match[2];
  }
  return { scheme, params };
}

async function post(headers: Record<string, string>, url = 'https://acme.minusx.app/api/mcp') {
  const request = new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
  });
  const response = await POST(request);
  return { response, challenge: parseChallenge(response.headers.get('WWW-Authenticate') ?? '') };
}

describe('/api/mcp — 401 WWW-Authenticate challenge', () => {
  it('cites the protected resource metadata document so a client can discover the auth server', async () => {
    const { response, challenge } = await post({ host: 'acme.minusx.app', 'x-forwarded-proto': 'https' });

    expect(response.status).toBe(401);
    expect(challenge.scheme).toBe('Bearer');
    expect(challenge.params.resource_metadata).toBe(
      'https://acme.minusx.app/.well-known/oauth-protected-resource'
    );
  });

  it('derives the metadata URL from the request, so a subdomain is sent to its own document', async () => {
    const { challenge } = await post(
      { host: 'other-workspace.minusx.app', 'x-forwarded-proto': 'https' },
      'https://other-workspace.minusx.app/api/mcp'
    );

    expect(challenge.params.resource_metadata).toContain('https://other-workspace.minusx.app/');
  });

  it('takes the first hop when a proxy chain appends to x-forwarded-proto', async () => {
    // ngrok and stacked proxies send "https, https"; naively interpolating that produces a
    // resource_metadata URL no client can fetch.
    const { challenge } = await post({ host: 'acme.minusx.app', 'x-forwarded-proto': 'https, https' });

    expect(challenge.params.resource_metadata).toBe(
      'https://acme.minusx.app/.well-known/oauth-protected-resource'
    );
  });

  it('does not claim invalid_token when no credentials were offered', async () => {
    // RFC 6750 §3.1: the error code describes a request that presented something wrong. Sending
    // it to a client that has not authenticated yet tells it its credentials were rejected.
    const { challenge } = await post({ host: 'acme.minusx.app', 'x-forwarded-proto': 'https' });

    expect(challenge.params.error).toBeUndefined();
  });

  it('reports invalid_token when a bearer token was presented and rejected', async () => {
    const { challenge } = await post({
      host: 'acme.minusx.app',
      'x-forwarded-proto': 'https',
      authorization: 'Bearer expired-or-bogus',
    });

    expect(challenge.params.error).toBe('invalid_token');
  });

  it('exposes WWW-Authenticate to cross-origin clients, which is what makes the challenge readable', async () => {
    const { response } = await post({ host: 'acme.minusx.app', 'x-forwarded-proto': 'https' });

    expect(response.headers.get('Access-Control-Expose-Headers')).toContain('WWW-Authenticate');
  });

  it('still answers JSON-RPC, so an authenticated client parsing the body is unaffected', async () => {
    const { response } = await post({ host: 'acme.minusx.app', 'x-forwarded-proto': 'https' });

    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized' },
      id: null,
    });
  });
});
