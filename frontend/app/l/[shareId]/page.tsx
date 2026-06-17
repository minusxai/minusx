import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { resolveShare } from '@/lib/data/files.server';
import type { StoryContent } from '@/lib/types';
import { MINUSX_TAGLINE, truncate } from '@/lib/og/og-helpers';
import ShareClientBoundary from './ShareClientBoundary';

/** Absolute origin from the request host — correct behind ngrok/proxy/prod (Next's
 *  file-convention og:image only resolves to the dev localhost, so we set images by hand). */
async function requestOrigin(): Promise<string> {
  try {
    const hdrs = await headers();
    const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? '';
    const proto = (hdrs.get('x-forwarded-proto') ?? 'http').split(',')[0].trim();
    return host ? `${proto}://${host}` : '';
  } catch {
    return '';
  }
}

interface SharePageProps {
  params: Promise<{ shareId: string }>;
}

/**
 * Server-rendered OG/Twitter tags for the shared story so crawlers get a real title +
 * description (the `opengraph-image.tsx` sibling supplies the image). The nonce in
 * `shareId` is the authorization; invalid/revoked → empty so the page inherits root defaults.
 */
export async function generateMetadata({ params }: SharePageProps): Promise<Metadata> {
  const { shareId } = await params;
  const resolved = await resolveShare(shareId).catch(() => null);
  if (!resolved) return {};
  const title = resolved.file.name;
  const description = truncate((resolved.file.content as StoryContent | null)?.description?.trim() || MINUSX_TAGLINE, 200);
  // Absolute og:image to the public per-share route (?v= busts caches on edit). Set
  // explicitly (with dimensions) rather than via the file convention, which would only
  // emit the dev localhost host.
  const image = `${await requestOrigin()}/l/${shareId}/og?v=${resolved.file.version}`;
  const images = [{ url: image, width: 1200, height: 630, type: 'image/png' }];
  return {
    title,
    description,
    openGraph: { title, description, type: 'article', images },
    twitter: { card: 'summary_large_image', title, description, images },
  };
}

/**
 * Public landing for a shared data story (host/l/<shareId>). The body renders client-only
 * (ShareClientBoundary) so the server emits clean <head> metadata; access is enforced
 * server-side by the guest session.
 */
export default async function SharePage({ params }: SharePageProps) {
  const { shareId } = await params;
  return <ShareClientBoundary shareId={shareId} />;
}
