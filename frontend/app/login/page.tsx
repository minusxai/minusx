import { headers } from 'next/headers';
import { CompanyDB } from '@/lib/database/company-db';
import { LoginOrRegisterForm } from './LoginOrRegisterForm';
import { CompanyConfig, DEFAULT_CONFIG } from '@/lib/branding/whitelabel';
import { getConfigsByCompanyId } from '@/lib/data/configs.server';

/**
 * Login page - checks if companies exist server-side
 * Shows login form if companies exist, registration form if not
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Get invite code from URL parameters
  const params = await searchParams;
  const inviteCode = typeof params.invite_code === 'string' ? params.invite_code : null;
  // Check if any companies exist (server-side)
  let hasCompanies = false;
  let defaultCompanyName: string | null = null;
  let loginPageConfig: CompanyConfig | null = null;

  try {
    const count = await CompanyDB.count();
    hasCompanies = count > 0;
  } catch (error) {
    console.error('[LoginPage] Failed to check company count:', error);
    // On error, assume companies exist and show login form
    hasCompanies = true;
  }

  // Check if multiple companies are allowed (default: false)
  const allowMultipleCompanies = process.env.ALLOW_MULTIPLE_COMPANIES === 'true';

  // Extract subdomain from headers (set by middleware)
  const headersList = await headers();
  const subdomain = headersList.get('x-subdomain');
  console.log('[LoginPage] x-subdomain header:', subdomain);
  console.log('[LoginPage] ALLOW_MULTIPLE_COMPANIES:', process.env.ALLOW_MULTIPLE_COMPANIES);

  // Look up company by subdomain if present (multi-tenant mode)
  let subdomainCompanyName: string | null = null;
  let companyForConfig: { id: number; name: string } | null = null;

  if (subdomain) {
    try {
      const company = await CompanyDB.getBySubdomain(subdomain);
      console.log('[LoginPage] Company lookup result for subdomain:', subdomain, '→', company ? company.name : 'NOT FOUND');
      if (company) {
        subdomainCompanyName = company.name;
        companyForConfig = company;
      }
      // If company not found, subdomainCompanyName stays null
      // Client-side form will show error (no redirect needed)
    } catch (error) {
      console.error('[LoginPage] Failed to fetch company by subdomain:', error);
    }
  }

  // Get default company if in single-tenant mode
  if (!allowMultipleCompanies) {
    try {
      const defaultCompany = await CompanyDB.getDefaultCompany();
      if (defaultCompany) {
        defaultCompanyName = defaultCompany.name;
        companyForConfig = defaultCompany;
      }
    } catch (error) {
      console.error('[LoginPage] Failed to fetch default company:', error);
    }
  }

  // Load company-specific config for branding (single-tenant or subdomain mode)
  if (companyForConfig) {
    try {
      const result = await getConfigsByCompanyId(companyForConfig.id);
      loginPageConfig = result.config;
    } catch (error) {
      console.error('[LoginPage] Failed to load company config:', error);
      // Fallback to default config
      loginPageConfig = DEFAULT_CONFIG;
    }
  }

  // Check if we should show marketing page instead of login
  // Only on main domain (no subdomain), multi-tenant mode, and CREATE_COMPANY_SECRET is set
  const hasCompanySecret = !!process.env.CREATE_COMPANY_SECRET;
  const showMarketingPage = !subdomain && allowMultipleCompanies && hasCompanySecret;

  return (
    <LoginOrRegisterForm
      hasCompanies={hasCompanies}
      allowMultipleCompanies={allowMultipleCompanies}
      defaultCompanyName={defaultCompanyName}
      subdomain={subdomain}
      subdomainCompanyName={subdomainCompanyName}
      companyConfig={loginPageConfig}
      showMarketingPage={showMarketingPage}
      inviteCode={inviteCode}
    />
  );
}
