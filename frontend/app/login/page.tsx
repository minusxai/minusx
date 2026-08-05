import { headers } from 'next/headers';
import { OrgConfig, DEFAULT_CONFIG } from '@/lib/branding/whitelabel';
import { LoginOrRegisterForm } from './LoginOrRegisterForm';
import { getConfigsForMode } from '@/lib/data/configs.server';
import { UserDB } from '@/lib/database/user-db';
import { MD_LOGIN, MD_REGISTER, LANDING_HTML, ENABLE_ORG_CREATION, AUTH_URL } from '@/lib/config';

/**
 * The query string is read HERE and handed down as props, rather than with `useSearchParams()`
 * inside the form. That hook opts its subtree out of server rendering: the form would stream into
 * a hidden Suspense segment, leaving no field on screen until the bundle executes — a "typed
 * right after load and lost it" window. Reading the params on the server keeps the form in the
 * initial HTML, so it paints immediately and hydrates in place.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // `?register` with ANY value, including empty, forces the workspace-setup form.
  const forceRegister = params.register !== undefined;
  const callbackUrlParam = params.callbackUrl;
  const callbackUrl = Array.isArray(callbackUrlParam) ? callbackUrlParam[0] : callbackUrlParam;

  // Only show landing text on the canonical host, not when reached by another one
  const hdrs = await headers();
  const host = hdrs.get('host') || '';
  const rootHost = new URL(AUTH_URL).host;
  const isRootDomain = host === rootHost;

  let hasUsers = false;
  try {
    const users = await UserDB.listAll();
    hasUsers = users.length > 0;
  } catch {
    // DB not yet ready — treat as having users to avoid showing register form unexpectedly
    hasUsers = true;
  }

  let loginPageConfig: OrgConfig = DEFAULT_CONFIG;
  let hasEmailOTP = false;
  try {
    const result = await getConfigsForMode();
    loginPageConfig = result.config;
    hasEmailOTP = !!loginPageConfig.messaging?.webhooks?.some((w: any) => w.type === 'email_otp');
  } catch {}

  return (
    <LoginOrRegisterForm
      orgConfig={loginPageConfig}
      hasEmailOTP={hasEmailOTP}
      loginText={MD_LOGIN || undefined}
      registerText={MD_REGISTER || undefined}
      initialMode={hasUsers ? 'login' : 'register'}
      landingHtml={isRootDomain ? (LANDING_HTML || undefined) : undefined}
      enableOrgCreation={ENABLE_ORG_CREATION}
      forceRegister={forceRegister}
      callbackUrl={callbackUrl}
    />
  );
}
