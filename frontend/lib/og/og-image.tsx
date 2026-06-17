/**
 * Open Graph SHARE card generation (server-only). Resolves a public story, blurs its
 * captured cover (meta.preview), and composes the cover card; falls back to the generic
 * branded card when there's no cover yet (or a dead/revoked link). Imports files.server,
 * so only the per-share route may import this — never the generic root card.
 */
import 'server-only';
import sharp from 'sharp';
import { resolveShare } from '@/lib/data/files.server';
import { createObjectStore, isLocalObjectStore } from '@/lib/object-store';
import type { StoryContent } from '@/lib/types';
import { ogCacheKey, truncate } from '@/lib/og/og-helpers';
import { StoryCoverCard, imageResponse, renderGenericOgImage, OG_SIZE } from '@/lib/og/og-cards';

export { OG_SIZE, renderGenericOgImage };

/**
 * Pre-blur the cover with sharp (satori can't do CSS blur). Accepts a data URL or remote
 * URL; brightens for the light tone / darkens for the dark tone so the frost reads cleanly.
 * Returns a blurred JPEG data URL, or null on failure.
 */
async function blurCover(coverUrl: string, tone: 'light' | 'dark'): Promise<string | null> {
  try {
    let input: Buffer;
    if (coverUrl.startsWith('data:')) {
      input = Buffer.from(coverUrl.slice(coverUrl.indexOf(',') + 1), 'base64');
    } else {
      const ab = (await fetch(coverUrl).then((r) => r.arrayBuffer())) as ArrayBuffer;
      input = Buffer.from(new Uint8Array(ab));
    }
    const brightness = tone === 'light' ? 1.12 : 0.85;
    const out = await sharp(input).blur(5).modulate({ brightness }).jpeg({ quality: 80 }).toBuffer();
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch (err) {
    console.warn('[og] cover blur failed:', err);
    return null;
  }
}

/** Per-story cover card for a public share, with S3 caching in non-local deployments. */
export async function renderShareOgImage(shareId: string): Promise<Response> {
  const resolved = await resolveShare(shareId).catch(() => null);
  if (!resolved) return renderGenericOgImage();

  const { file } = resolved;
  const coverUrl = (file.meta as { preview?: { url?: string } } | null)?.preview?.url;
  // No captured cover yet → branded generic card (the og:title still carries the title).
  if (typeof coverUrl !== 'string' || !/^(https?:|data:)/.test(coverUrl)) return renderGenericOgImage();

  // Cache to S3 keyed on updated_at (skipped locally — the local-fs URL is auth-gated and
  // not crawler-reachable, so dev always renders fresh).
  const store = isLocalObjectStore() ? null : createObjectStore();
  const key = ogCacheKey(file.id, file.updated_at);
  if (store && (await store.exists(key).catch(() => false))) {
    return Response.redirect(store.publicUrl(key), 302);
  }

  // Contrast the story: dark story → brightened backdrop (light top → black logo), else darkened.
  const tone = (file.content as StoryContent | null)?.colorMode === 'dark' ? 'light' : 'dark';
  const element = (
    <StoryCoverCard coverUrl={(await blurCover(coverUrl, tone)) ?? coverUrl} title={truncate(file.name, 90)} tone={tone} />
  );

  // An ImageResponse body is consumed once read, so regenerate on a cache-write failure.
  if (store) {
    try {
      const buf = Buffer.from(await imageResponse(element).arrayBuffer());
      await store.put(key, buf, 'image/png');
      return new Response(buf, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600, s-maxage=86400' } });
    } catch (err) {
      console.warn('[og] cache write failed, serving fresh:', err);
    }
  }
  return imageResponse(element);
}
