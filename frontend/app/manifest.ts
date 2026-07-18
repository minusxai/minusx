import type { MetadataRoute } from 'next';
import { DEFAULT_CONFIG } from '@/lib/branding/whitelabel';
import { getConfigsForMode } from '@/lib/data/configs.server';
import { hashContent } from '@/lib/utils/query-hash';

export const dynamic = 'force-dynamic';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const config = await getConfigsForMode().then(({ config }) => config).catch(() => DEFAULT_CONFIG);
  const { branding } = config;
  const iconVersion = hashContent({
    favicon: branding.favicon,
    logoLight: branding.logoLight,
    logoDark: branding.logoDark,
  });

  return {
    id: '/',
    name: branding.displayName,
    short_name: branding.agentName,
    description: branding.tagline || 'Your data stack, staffed by agents',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0D1117',
    theme_color: '#0D1117',
    icons: [
      {
        src: `/pwa-icon/192?v=${iconVersion}`,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: `/pwa-icon/512?v=${iconVersion}`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: `/pwa-icon/512?maskable=1&v=${iconVersion}`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
