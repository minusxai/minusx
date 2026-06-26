/**
 * Capture a story's social-share card, client-side, when the story is made public.
 *
 * Screenshots the rendered story (charts + custom CSS) via html-to-image and POSTs it to
 * the preview route, which composes the final card (blur + title + logo) and stores it.
 * Best-effort — returns true on success, false on failure (e.g. the story isn't on-screen).
 * Requires the `[data-story-capture]` element, present when the share modal opens over the
 * story page.
 */
import { toJpeg } from 'html-to-image';
import { getCachedFontEmbedCSS } from '@/lib/screenshot/font-embed-cache';

const OG_ASPECT = 1200 / 630;

export async function captureStoryPreview(fileId: number): Promise<boolean> {
  try {
    const el = document.querySelector(`[data-story-capture="${fileId}"]`) as HTMLElement | null;
    const width = el?.offsetWidth ?? 0;
    if (!el || !width) return false;
    const height = Math.round(width / OG_ASPECT); // top band at OG aspect
    const screenshot = await toJpeg(el, {
      width,
      height,
      pixelRatio: Math.max(1, 1200 / width), // ~1200px-wide source for the card
      backgroundColor: '#ffffff',
      quality: 0.9,
      // cacheBust was forcing a re-fetch of every embedded resource on each capture — dropped.
      // Reuse the cached, font-agnostic @font-face embedding instead of html-to-image re-doing it.
      fontEmbedCSS: await getCachedFontEmbedCSS(el),
    });
    const res = await fetch(`/api/files/${fileId}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ screenshot }),
    });
    return res.ok;
  } catch (err) {
    console.warn('[story-og] preview capture failed:', err);
    return false;
  }
}
