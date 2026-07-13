import type { Metadata } from "next";
import { cache } from "react";
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import "./globals.css";
import { Providers } from "@/components/app-shell/Providers";
import LayoutWrapper from "@/components/app-shell/LayoutWrapper";
import { Inter, JetBrains_Mono } from 'next/font/google';
import { getEffectiveUser, type EffectiveUser } from '@/lib/auth/auth-helpers';
import { E2E_HEADER } from '@/lib/auth/e2e-runtime';
import { getConfigs, getConfigsForMode, getOrgStyles, getStylesForMode } from '@/lib/data/configs.server';
import { OrgConfig, DEFAULT_CONFIG, DEFAULT_STYLES, getBrandTagline } from '@/lib/branding/whitelabel';
import { redactRawConfigSecrets } from '@/lib/secrets/config-secret-specs';
import { ANALYTICS_CONFIG, DISABLE_APP_STATE_IMAGES, MAX_CONCURRENT_QUERIES, QUERY_TIMEOUT_MS, CREDITS_ENABLED, TELEMETRY_LEVEL } from '@/lib/config';
import { parseAnalyticsConfig } from '@/lib/constants';
import { TELEMETRY_LEVEL_ATTR } from '@/lib/telemetry';
import type { AnalyticsConfig } from '@/lib/analytics/types';
import { GlobalErrorHandler } from '@/components/app-shell/ErrorHandler';
import { Toaster } from '@/components/ui/toaster';
import ImageLightbox from '@/components/ui/ImageLightbox';

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

export async function generateMetadata(): Promise<Metadata> {
  let config = DEFAULT_CONFIG;
  const user = await getEffectiveUserCached();
  if (user) {
    try {
      const result = await getConfigs(user);
      config = result.config;
    } catch {}
  } else {
    try {
      const result = await getConfigsForMode();
      config = result.config;
    } catch {}
  }
  const title = config.branding.agentName;
  const description = getBrandTagline(config.branding);
  // === SHARE IMAGE DISABLED === re-enable by uncommenting the block below + restoring `images` in the return.
  // Absolute og:image to the generic card route, built from the real request host (Next's
  // file-convention image only emits the dev localhost host, unusable behind ngrok/prod).
  // const hdrs = await headers();
  // const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? '';
  // const proto = (hdrs.get('x-forwarded-proto') ?? 'http').split(',')[0].trim();
  // const origin = host ? `${proto}://${host}` : '';
  // const images = [{ url: `${origin}/opengraph-image`, width: 1200, height: 630, type: 'image/png' }];
  return {
    title,
    description,
    icons: { icon: config.branding.favicon },
    // === SHARE IMAGE DISABLED === restore `, images` on the two lines below to re-enable.
    openGraph: { title, description, siteName: config.branding.displayName, type: 'website' /*, images */ },
    twitter: { card: 'summary', title, description /*, images */ },
  };
}

async function loadInitialState(): Promise<{
  user: EffectiveUser | null;
  config: OrgConfig;
  analyticsConfig: AnalyticsConfig;
  disableAppStateImages: boolean;
  maxConcurrentQueries: number;
  queryTimeoutMs: number;
  creditsEnabled: boolean;
  e2eEnabled: boolean;
}> {
  const user = await getEffectiveUserCached();
  let config: OrgConfig = DEFAULT_CONFIG;
  if (user) {
    try {
      const userConfigResult = await getConfigs(user);
      config = userConfigResult.config;
    } catch (error) {
      console.error('[Layout] Failed to load user config:', error);
    }
  } else {
    try {
      const result = await getConfigsForMode();
      config = result.config;
    } catch {}
  }
  return {
    user,
    // Secrets guard: config credentials are @SECRETS/… refs (safe), but legacy
    // docs may hold raw values — mask them before hydrating the client store.
    config: redactRawConfigSecrets(config),
    // ANALYTICS_CONFIG is already telemetry-level-aware (lib/config.ts): the
    // image-baked default only applies at `full`, and `off` zeroes it.
    analyticsConfig: parseAnalyticsConfig(ANALYTICS_CONFIG),
    disableAppStateImages: DISABLE_APP_STATE_IMAGES,
    maxConcurrentQueries: MAX_CONCURRENT_QUERIES,
    queryTimeoutMs: QUERY_TIMEOUT_MS,
    creditsEnabled: CREDITS_ENABLED,
    // QA runtime E2E opt-in: middleware stamps this header when `?e2e=<secret>`
    // (or its persisted cookie) matches. Exposes the store on the client.
    e2eEnabled: (await headers()).get(E2E_HEADER) === '1',
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Load user + configs + contexts (always) + connections (50ms timeout)
  const initialData = await loadInitialState();

  if (initialData.user && initialData.config.setupWizard?.status !== 'complete') {
    const reqPath = (await headers()).get('x-request-path') ?? '';
    // Redirect to onboarding wizard unless already there (or hitting an API/asset route)
    const shouldRedirect = reqPath === '/' || reqPath === '/p' || reqPath === '/p/org' || reqPath.startsWith('/explore');
    if (shouldRedirect) {
      redirect('/hello-world');
    }
  }

  // Load org styles (CSS for logos, etc.)
  let orgStyles = DEFAULT_STYLES;
  if (initialData.user) {
    try {
      orgStyles = await getOrgStyles(initialData.user);
    } catch (error) {
      console.error('[Layout] Failed to load styles for user:', error);
    }
  } else {
    try {
      orgStyles = await getStylesForMode();
    } catch {}
  }

  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
      // Telemetry-level handshake for the prebuilt client bundle:
      // instrumentation-client.ts reads this before initializing Sentry.
      {...{ [TELEMETRY_LEVEL_ATTR]: TELEMETRY_LEVEL }}
    >
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
          id="org-styles"
          dangerouslySetInnerHTML={{ __html: orgStyles }}
        />
      </head>
      <body suppressHydrationWarning>
        <Providers initialData={initialData}>
          <GlobalErrorHandler />
          <LayoutWrapper>
            {children}
          </LayoutWrapper>
          <Toaster />
          <ImageLightbox />
        </Providers>
      </body>
    </html>
  );
}
