/**
 * Capture a story's social-share card, client-side, when the story is made public.
 *
 * Screenshots the rendered story (charts + custom CSS) via html-to-image and POSTs it to
 * the preview route, which composes the final card (blur + title + logo) and stores it as
 * the story's og:image. Best-effort — returns the stored card URL, or null on failure
 * (e.g. the story isn't on-screen). Requires the `[data-story-capture]` element, which is
 * present when the share modal opens over the story page.
 */
import { toJpeg } from 'html-to-image';

const OG_ASPECT = 1200 / 630;

export async function captureStoryPreview(fileId: number): Promise<string | null> {
  try {
    const el = document.querySelector(`[data-story-capture="${fileId}"]`) as HTMLElement | null;
    const width = el?.offsetWidth ?? 0;
    if (!el || !width) return null;
    const height = Math.round(width / OG_ASPECT); // top band at OG aspect
    const screenshot = await toJpeg(el, {
      width,
      height,
      pixelRatio: Math.max(1, 1200 / width), // ~1200px-wide source for the card
      backgroundColor: '#ffffff',
      quality: 0.9,
      cacheBust: true,
    });
    const res = await fetch(`/api/files/${fileId}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ screenshot }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return (json?.data?.url as string | undefined) ?? null;
  } catch (err) {
    console.warn('[story-og] preview capture failed:', err);
    return null;
  }
}
