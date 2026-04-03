/**
 * MCP / OAuth Bearer token → EffectiveUser bridge
 *
 * Extracts Bearer token from request, validates against oauth_tokens,
 * and constructs an EffectiveUser for downstream tool execution.
 */

import 'server-only';
import { OAuthTokenDB } from '@/lib/oauth/db';
import { UserDB } from '@/lib/database/user-db';
import { CompanyDB } from '@/lib/database/company-db';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { DEFAULT_MODE } from '@/lib/mode/mode-types';

/**
 * Authenticate an incoming request using OAuth Bearer token.
 * Returns EffectiveUser or null if auth fails.
 */
export async function authenticateOAuthRequest(
  request: Request
): Promise<EffectiveUser | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  if (!token) return null;

  const tokenData = await OAuthTokenDB.validateAccessToken(token);
  if (!tokenData) return null;

  const user = await UserDB.getById(tokenData.userId, tokenData.companyId);
  if (!user) return null;

  const company = await CompanyDB.getById(tokenData.companyId);

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    home_folder: user.home_folder,
    companyId: tokenData.companyId,
    companyName: company?.name,
    mode: DEFAULT_MODE,
  };
}
