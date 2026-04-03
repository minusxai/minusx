/**
 * OAuth 2.1 Consent Screen
 *
 * Shows the user what client is requesting access, the scope,
 * and lets them approve or deny. Uses Chakra UI (inherits root layout).
 */

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { headers } from 'next/headers';
import OAuthConsentForm from './consent-form';

async function getExternalOrigin(): Promise<string> {
  const headersList = await headers();
  const protoHeader = headersList.get('x-forwarded-proto') || 'http';
  const proto = protoHeader.split(',')[0].trim();
  const host = headersList.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OAuthAuthorizePage({ searchParams }: PageProps) {
  const params = await searchParams;

  const clientId = params.client_id as string | undefined;
  const responseType = params.response_type as string | undefined;
  const redirectUri = params.redirect_uri as string | undefined;
  const codeChallenge = params.code_challenge as string | undefined;
  const codeChallengeMethod = (params.code_challenge_method as string) || 'S256';
  const state = params.state as string | undefined;
  const scope = params.scope as string | undefined;

  // Validate required params
  if (clientId !== 'minusx-mcp' || responseType !== 'code' || !redirectUri || !codeChallenge) {
    const message = !redirectUri ? 'Missing redirect URI'
      : !codeChallenge ? 'Missing PKCE code challenge'
      : clientId !== 'minusx-mcp' ? 'Invalid client'
      : 'Unsupported response type';
    return <OAuthConsentForm error={message} />;
  }

  // Check session
  const session = await auth();

  if (!session?.user?.companyId || !session?.user?.userId) {
    const origin = await getExternalOrigin();
    const currentUrl = new URL('/oauth/authorize', origin);
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') currentUrl.searchParams.set(key, value);
    }
    const loginUrl = new URL('/login', origin);
    loginUrl.searchParams.set('callbackUrl', currentUrl.toString());
    redirect(loginUrl.toString());
  }

  const user = session.user;

  let clientOrigin: string;
  try {
    clientOrigin = new URL(redirectUri).hostname;
  } catch {
    clientOrigin = redirectUri;
  }

  return (
    <OAuthConsentForm
      clientOrigin={clientOrigin}
      userName={user.name || user.email || ''}
      userEmail={user.email || ''}
      companyName={user.companyName || ''}
      redirectUri={redirectUri}
      codeChallenge={codeChallenge}
      codeChallengeMethod={codeChallengeMethod}
      state={state}
      scope={scope}
    />
  );
}
