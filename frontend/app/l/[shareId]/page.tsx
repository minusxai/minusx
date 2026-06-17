import type { Metadata } from 'next';
import { resolveShare } from '@/lib/data/files.server';
import type { StoryContent } from '@/lib/types';
import { MINUSX_TAGLINE, truncate } from '@/lib/og/og-helpers';
import ShareClientBoundary from './ShareClientBoundary';

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
  // The composed card (stored once at "make public"); when absent the page inherits the
  // generic root og:image (app/opengraph-image.tsx).
  const cardUrl = (resolved.file.meta as { preview?: { url?: string } } | null)?.preview?.url;
  const images = cardUrl ? [cardUrl] : undefined;
  return {
    title,
    description,
    openGraph: { title, description, type: 'article', ...(images ? { images } : {}) },
    twitter: { card: 'summary_large_image', title, description, ...(images ? { images } : {}) },
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
