import type { Metadata } from "next";
import { cache } from "react";
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import "./globals.css";
import { Providers } from "@/components/Providers";
import LayoutWrapper from "@/components/LayoutWrapper";
import { Inter, JetBrains_Mono } from 'next/font/google';
import { getEffectiveUser, type EffectiveUser } from '@/lib/auth/auth-helpers';
import { getConfigs, getConfigsForMode, getOrgStyles, getStylesForMode } from '@/lib/data/configs.server';
import { OrgConfig, DEFAULT_CONFIG, DEFAULT_STYLES } from '@/lib/branding/whitelabel';
import { GlobalErrorHandler } from '@/components/ErrorHandler';
import { Toaster } from '@/components/ui/toaster';
import FileModal from '@/components/modals/FileModal';

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
  return {
    title: config.branding.agentName,
    description: "Next-generation business intelligence",
    icons: { icon: config.branding.favicon },
  };
}

async function loadInitialState(): Promise<{
  user: EffectiveUser | null;
  config: OrgConfig;
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
  return { user, config };
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
    if (reqPath.startsWith('/p/')) {
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

  console.log('[Layout] Final styles length:', orgStyles.length);

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
          id="org-styles"
          dangerouslySetInnerHTML={{ __html: orgStyles }}
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
