import { Suspense } from 'react';
import { headers } from 'next/headers';
import { OrgConfig, DEFAULT_CONFIG } from '@/lib/branding/whitelabel';
import { LoginOrRegisterForm } from './LoginOrRegisterForm';
import { getConfigsForMode } from '@/lib/data/configs.server';
import { UserDB } from '@/lib/database/user-db';
import { MD_LOGIN, MD_REGISTER, LANDING_HTML, ENABLE_ORG_CREATION, AUTH_URL } from '@/lib/config';

export default async function LoginPage() {
  // Only show landing text on the root domain, not on company subdomains
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
    <Suspense>
      <LoginOrRegisterForm
        orgConfig={loginPageConfig}
        hasEmailOTP={hasEmailOTP}
        loginText={MD_LOGIN || undefined}
        registerText={MD_REGISTER || undefined}
        initialMode={hasUsers ? 'login' : 'register'}
        landingHtml={isRootDomain ? (LANDING_HTML || undefined) : undefined}
        enableOrgCreation={ENABLE_ORG_CREATION}
      />
    </Suspense>
  );
}
