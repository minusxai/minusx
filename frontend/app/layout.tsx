import type { Metadata } from "next";
import { cache } from "react";
import "./globals.css";
import { Providers } from "@/components/Providers";
import LayoutWrapper from "@/components/LayoutWrapper";
import { Inter, JetBrains_Mono } from 'next/font/google';
import { getEffectiveUser, type EffectiveUser } from '@/lib/auth/auth-helpers';
import { getConfigs, getConfigsByCompanyId, getCompanyStyles, getCompanyStylesById } from '@/lib/data/configs.server';
import { CompanyConfig, DEFAULT_CONFIG, DEFAULT_STYLES } from '@/lib/branding/whitelabel';
import { GlobalErrorHandler } from '@/components/ErrorHandler';
import { Toaster } from '@/components/ui/toaster';
import FileModal from '@/components/modals/FileModal';
import { CompanyDB } from '@/lib/database/company-db';
import { headers } from 'next/headers';
import { extractSubdomain, isSubdomainRoutingEnabled } from '@/lib/utils/subdomain';

// cache() deduplicates these DB calls within a single request — both generateMetadata()
// and RootLayout call them, so without cache() the DB is hit twice per render.
const getDefaultCompanyCached = cache(() => CompanyDB.getDefaultCompany());
const getEffectiveUserCached = cache(() => getEffectiveUser().catch(() => null));

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  weight: ['400', '500', '600', '700', '800', '900'],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  weight: ['400', '500', '600', '700'],
});

/**
 * Generate metadata dynamically based on company config
 * Tries: 1) default company (single-tenant mode), 2) authenticated user, 3) defaults
 */
export async function generateMetadata(): Promise<Metadata> {
  let config = DEFAULT_CONFIG;

  // Run both lookups in parallel; cache() ensures the DB is not hit again when
  // loadInitialState() calls the same helpers during the same render.
  const [defaultCompany, user] = await Promise.all([
    getDefaultCompanyCached().catch((error) => {
      console.error('[Metadata] Failed to load default company:', error);
      return null;
    }),
    getEffectiveUserCached(),
  ]);

  if (defaultCompany) {
    try {
      const result = await getConfigsByCompanyId(defaultCompany.id);
      config = result.config;
    } catch (error) {
      console.error('[Metadata] Failed to load default company config:', error);
    }
  }

  if (user?.companyId) {
    try {
      const result = await getConfigs(user);
      config = result.config;
    } catch {
      // Not authenticated or error, keep config from above
    }
  }

  return {
    title: config.branding.agentName,
    description: "Next-generation business intelligence",
    icons: {
      icon: config.branding.favicon,
    },
  };
}

/**
 * Load initial state: config (pre-login) + user
 * Config loads first (before auth) to support pre-login branding
 * Contexts and connections are now loaded client-side via hooks
 */
async function loadInitialState(): Promise<{
  user: EffectiveUser | null;
  config: CompanyConfig;
}> {
  // Fetch default company and session user in parallel — they're independent.
  // cache() ensures these DB calls are deduplicated with generateMetadata().
  const [defaultCompany, user] = await Promise.all([
    getDefaultCompanyCached().catch((error) => {
      console.error('[Layout] Failed to load default company:', error);
      return null;
    }),
    getEffectiveUserCached(),
  ]);

  let config: CompanyConfig = DEFAULT_CONFIG;

  if (user?.companyId) {
    // Authenticated: load user's company config directly — it overrides the default
    // company config anyway, so there's no need to load the default first.
    try {
      const userConfigResult = await getConfigs(user);
      config = userConfigResult.config;
      console.log(`[Layout] Loaded config for user's company: ${user.companyName}`);
    } catch (error) {
      console.error('[Layout] Failed to load user config:', error);
      // Fall back to default company config below
      if (defaultCompany) {
        try {
          const result = await getConfigsByCompanyId(defaultCompany.id);
          config = result.config;
        } catch {}
      }
    }
  } else if (defaultCompany) {
    // Not authenticated: use default company config for pre-login branding
    try {
      const result = await getConfigsByCompanyId(defaultCompany.id);
      config = result.config;
      console.log(`[Layout] Loaded config for default company: ${defaultCompany.name} (ID: ${defaultCompany.id})`);
    } catch (error) {
      console.error('[Layout] Failed to load default company config:', error);
    }
  }

  return { user, config };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Load user + configs + contexts (always) + connections (50ms timeout)
  const initialData = await loadInitialState();

  // Load company styles (CSS for logos, etc.)
  let companyStyles = DEFAULT_STYLES;

  // Prioritize: 1) user's company, 2) default company ID, 3) defaults
  if (initialData.user) {
    // User is logged in - use their company (priority)
    console.log('[Layout] Loading styles by user:', initialData.user.email, 'companyId:', initialData.user.companyId);
    try {
      companyStyles = await getCompanyStyles(initialData.user);
    } catch (error) {
      console.error('[Layout] Failed to load styles for user:', error);
    }
  } else {
    // No user - check for subdomain or default company
    let companyIdForStyles: number | null = null;

    // Try subdomain first (multi-tenant with subdomain)
    if (isSubdomainRoutingEnabled()) {
      const headersList = await headers();
      const subdomain = headersList.get('x-subdomain');
      console.log('[Layout] Subdomain routing enabled, subdomain from header:', subdomain);

      if (subdomain) {
        try {
          const company = await CompanyDB.getBySubdomain(subdomain);
          console.log('[Layout] Company lookup result for subdomain:', subdomain, '→', company);
          if (company) {
            console.log('[Layout] Loading styles for subdomain company:', company.name, '(ID:', company.id + ')');
            companyIdForStyles = company.id;
          }
        } catch (error) {
          console.error('[Layout] Failed to load subdomain company:', error);
        }
      }
    }

    // Fall back to default company (single-tenant mode)
    if (!companyIdForStyles) {
      try {
        const defaultCompany = await CompanyDB.getDefaultCompany();
        if (defaultCompany) {
          console.log('[Layout] Loading styles for default company:', defaultCompany.name, '(ID:', defaultCompany.id + ')');
          companyIdForStyles = defaultCompany.id;
        } else {
          console.log('[Layout] No user and not in single-tenant mode - using DEFAULT_STYLES');
        }
      } catch (error) {
        console.error('[Layout] Failed to load styles for default company:', error);
      }
    }

    // Load styles if we have a company ID
    if (companyIdForStyles) {
      try {
        companyStyles = await getCompanyStylesById(companyIdForStyles);
      } catch (error) {
        console.error('[Layout] Failed to load styles:', error);
      }
    }
  }

  console.log('[Layout] Final styles length:', companyStyles.length);

  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var colorMode = localStorage.getItem('chakra-ui-color-mode');
                  if (colorMode === 'dark') {
                    document.documentElement.classList.add('dark');
                    document.documentElement.style.colorScheme = 'dark';
                  } else if (colorMode === 'light') {
                    document.documentElement.classList.remove('dark');
                    document.documentElement.style.colorScheme = 'light';
                  } else {
                    // Default to dark mode if no preference is set
                    document.documentElement.classList.add('dark');
                    document.documentElement.style.colorScheme = 'dark';
                    localStorage.setItem('chakra-ui-color-mode', 'dark');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
        <style
          id="company-styles"
          dangerouslySetInnerHTML={{ __html: companyStyles }}
        />
      </head>
      <body suppressHydrationWarning>
        <Providers initialData={initialData}>
          <GlobalErrorHandler />
          <FileModal />
          <LayoutWrapper>
            {children}
          </LayoutWrapper>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
