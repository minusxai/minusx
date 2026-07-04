/**
 * OAuth token endpoint — end-to-end refresh flow.
 *
 * Drives the real POST /oauth/token route handler against a real PGLite DB and
 * real JWT signing, then validates the resulting access token through the real
 * MCP bearer-token bridge (authenticateOAuthRequest). Covers:
 *  - authorization_code → access_token + refresh_token
 *  - refresh_token → a new token pair (the fix for hourly MCP disconnects)
 *  - the refreshed access token authenticates as the correct user via MCP
 *  - token-type isolation: a refresh token can't be used as a Bearer access
 *    token, and an access token can't be redeemed at the refresh grant
 */

import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { POST as tokenPost } from '@/app/oauth/token/route';
import { authenticateOAuthRequest } from '@/lib/mcp/auth';
import { OAuthCodeDB } from '@/lib/oauth/db';
import { UserDB } from '@/lib/database/user-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';
import { setupTestDb } from '@/test/harness/test-db';

const TEST_DB_PATH = getTestDbPath('oauth_refresh_e2e');
const REDIRECT_URI = 'http://localhost:3000/oauth/callback';
const VERIFIER = 'a'.repeat(64); // PKCE verifier (≥43 chars)
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

// Real OAuth/MCP clients POST application/x-www-form-urlencoded, so exercise
// that branch of the route (not the JSON one) to match production.
function tokenRequest(body: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost:3000/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
}

function bearer(token: string): Request {
  return new Request('http://localhost:3000/mcp', { headers: { authorization: `Bearer ${token}` } });
}

async function newAuthCode(userId: number): Promise<string> {
  return OAuthCodeDB.create(userId, REDIRECT_URI, CHALLENGE);
}

describe('OAuth token endpoint — refresh flow (e2e)', () => {
  setupTestDb(TEST_DB_PATH);

  let userId: number;
  beforeEach(async () => {
    const user = await UserDB.getByEmail('test@example.com');
    userId = user!.id;
  });

  it('authorization_code → refresh_token → MCP validates the refreshed token', async () => {
    const code = await newAuthCode(userId);

    // 1) Exchange the auth code for the first token pair.
    const codeRes = await tokenPost(tokenRequest({
      grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: REDIRECT_URI,
    }));
    expect(codeRes.status).toBe(200);
    const pair1 = await codeRes.json();
    expect(pair1.access_token).toBeTruthy();
    expect(pair1.refresh_token).toBeTruthy();

    // 2) Use the refresh token to get a fresh pair (the disconnect fix).
    const refreshRes = await tokenPost(tokenRequest({
      grant_type: 'refresh_token', refresh_token: pair1.refresh_token,
    }));
    expect(refreshRes.status).toBe(200);
    const pair2 = await refreshRes.json();
    expect(pair2.access_token).toBeTruthy();
    expect(pair2.refresh_token).toBeTruthy();
    expect(pair2.access_token).not.toBe(pair1.access_token);

    // 3) The refreshed access token authenticates as the correct user via MCP.
    const user = await authenticateOAuthRequest(bearer(pair2.access_token));
    expect(user).not.toBeNull();
    expect(user!.userId).toBe(userId);
  });

  it('survives repeated refreshes (stateless — no server-side store)', async () => {
    const code = await newAuthCode(userId);
    const pair1 = await (await tokenPost(tokenRequest({
      grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: REDIRECT_URI,
    }))).json();

    // The same refresh token can be redeemed more than once (JWT is not single-use).
    const r1 = await tokenPost(tokenRequest({ grant_type: 'refresh_token', refresh_token: pair1.refresh_token }));
    const r2 = await tokenPost(tokenRequest({ grant_type: 'refresh_token', refresh_token: pair1.refresh_token }));
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });

  it('rejects a refresh token used as a Bearer access token (MCP path)', async () => {
    const code = await newAuthCode(userId);
    const { refresh_token } = await (await tokenPost(tokenRequest({
      grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: REDIRECT_URI,
    }))).json();

    expect(await authenticateOAuthRequest(bearer(refresh_token))).toBeNull();
  });

  it('rejects an access token redeemed at the refresh grant', async () => {
    const code = await newAuthCode(userId);
    const { access_token } = await (await tokenPost(tokenRequest({
      grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: REDIRECT_URI,
    }))).json();

    const res = await tokenPost(tokenRequest({ grant_type: 'refresh_token', refresh_token: access_token }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_grant');
  });
});
