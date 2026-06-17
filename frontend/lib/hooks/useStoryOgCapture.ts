'use client';

/**
 * Captures a story's social-share preview image, client-side.
 *
 * Social crawlers can't run JS, so the OG image can't screenshot the story on demand.
 * Instead, whenever the authenticated story view is open in a real browser and the stored
 * preview is missing or stale (vs the file's `updated_at`), we screenshot the rendered
 * story (charts + custom CSS and all) with html-to-image, upload it, and persist the URL
 * on the file's `meta.preview`. The OG route then composites the title/logo over it.
 *
 * Best-effort and silent: any failure just leaves the editorial fallback card in place.
 */
import { useEffect, useRef } from 'react';
import { toJpeg } from 'html-to-image';
import { uploadBlobOrEmbed } from '@/lib/object-store/client';

const OG_ASPECT = 1200 / 630;
const CAPTURE_DELAY_MS = 1800; // let embedded charts finish rendering first

export function useStoryOgCapture(params: {
  fileId: number | undefined;
  updatedAt: string | undefined;
  storedVersion: string | undefined;
  hasStory: boolean;
}): void {
  const { fileId, updatedAt, storedVersion, hasStory } = params;
  // Set to the version tag only once the capture has actually STARTED (inside the debounced
  // timer). Setting it in the effect body would let a re-render's cleanup cancel the pending
  // timer while the guard blocks re-scheduling — so the capture would never fire.
  const ranRef = useRef<string>('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof fileId !== 'number' || !hasStory || !updatedAt) return;
    if (storedVersion === updatedAt) return; // preview already current
    const tag = `${fileId}:${updatedAt}`;
    if (ranRef.current === tag) return; // already captured this version this mount

    let cancelled = false;
    // Debounced: every re-render reschedules; the timer only survives once renders settle.
    const timer = setTimeout(async () => {
      if (ranRef.current === tag) return;
      ranRef.current = tag; // claim this version so we run exactly once
      try {
        const el = document.querySelector(`[data-story-capture="${fileId}"]`) as HTMLElement | null;
        const width = el?.offsetWidth ?? 0;
        if (!el || !width || cancelled) return;
        const height = Math.round(width / OG_ASPECT); // top band at OG aspect
        const dataUrl = await toJpeg(el, {
          width,
          height,
          pixelRatio: Math.max(1, 1200 / width), // ~1200px-wide output
          backgroundColor: '#ffffff',
          quality: 0.85,
          cacheBust: true,
        });
        if (cancelled) return;
        const blob = await fetch(dataUrl).then((r) => r.blob());
        const url = await uploadBlobOrEmbed(blob, `story-${fileId}-og.jpg`, 'image/jpeg');
        if (cancelled) return;
        await fetch(`/api/files/${fileId}/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
      } catch (err) {
        console.warn('[story-og] preview capture failed:', err);
        ranRef.current = ''; // allow a retry on a later render
      }
    }, CAPTURE_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fileId, updatedAt, storedVersion, hasStory]);
}
