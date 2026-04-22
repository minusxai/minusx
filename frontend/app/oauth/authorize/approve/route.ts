/**
 * OAuth Approve Action
 *
 * POST: User approved consent → generate auth code → redirect to client.
 * Called by the consent form submission.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { OAuthCodeDB } from '@/lib/oauth/db';
import { getModules } from '@/lib/modules/registry';

export async function POST(request: NextRequest) {
  const session = await auth();
  await getModules().auth.addHeaders(request, new Headers());

  if (!session?.user?.userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const formData = await request.formData();
  const redirectUri = formData.get('redirect_uri') as string;
  const codeChallenge = formData.get('code_challenge') as string;
  const codeChallengeMethod = formData.get('code_challenge_method') as string || 'S256';
  const state = formData.get('state') as string | null;
  const scope = formData.get('scope') as string | null;

  if (!redirectUri || !codeChallenge) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    const code = await OAuthCodeDB.create(
      session.user.userId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      scope || undefined
    );

    const url = new URL(redirectUri);
    url.searchParams.set('code', code);
    if (state) url.searchParams.set('state', state);
    return NextResponse.redirect(url, 303);
  } catch {
    const url = new URL(redirectUri);
    url.searchParams.set('error', 'server_error');
    if (state) url.searchParams.set('state', state);
    return NextResponse.redirect(url, 303);
  }
}
