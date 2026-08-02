'use client';

/**
 * useSlideThumbnails — debounced slide-content thumbnails for the birds-eye rail.
 *
 * One capture per content rebuild (renderKey), armed after a short debounce so the
 * surface has painted, then RE-armed by two trailing-debounce signals: iframe resize
 * (embeds hydrate long after mount and each hydration grows the surface) and DOM
 * mutations inside the story root (WYSIWYG edits — typing, format toolbar, grid drags —
 * change content at constant height, which no resize ever reports). Mutations that are
 * only `data-mx-*` attribute churn are ignored: hover/selection markers flip on every
 * mouse move in edit mode and are render artifacts, not content. Both signal streams go
 * quiet once the surface settles, so re-capture terminates by construction — and the
 * capture itself never mutates the live DOM (it works on a clone), so it cannot feed
 * its own observer.
 *
 * Stale thumbnails are kept while a fresh capture is pending (no flicker); the rail
 * guards against count mismatches by falling back to its title list.
 */
import { useEffect, useState } from 'react';

import { captureSlideThumbnails } from './slide-thumbs';
import type { SlideNav } from './use-slide-nav';

const FIRST_CAPTURE_MS = 1200;
const RESIZE_RECAPTURE_MS = 1500;
const EDIT_RECAPTURE_MS = 2000; // trailing — typing keeps pushing this out; capture lands after the pause

export function useSlideThumbnails(nav: SlideNav, renderKey: string, enabled: boolean): string[] | null {
  const [thumbs, setThumbs] = useState<string[] | null>(null);
  const { slides, frame } = nav;

  useEffect(() => {
    if (!enabled || slides.length < 2 || !frame) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const capture = async () => {
      const urls = await captureSlideThumbnails(frame, slides.map((s) => s.el));
      if (!cancelled && urls && urls.length === slides.length) setThumbs(urls);
    };
    const arm = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(capture, ms);
    };
    arm(FIRST_CAPTURE_MS);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => arm(RESIZE_RECAPTURE_MS)) : null;
    ro?.observe(frame);
    // Edit mutations: observe the story root from ITS OWN realm (parent-realm observers on
    // iframe-document elements are unreliable — the lib/story-surface lesson).
    const idoc = frame.contentDocument;
    const root = idoc?.querySelector('[data-mx-story-root]');
    const InnerMO = idoc?.defaultView?.MutationObserver;
    let mo: MutationObserver | null = null;
    if (root && InnerMO) {
      mo = new InnerMO((records) => {
        const meaningful = records.some(
          (r) => r.type !== 'attributes' || !(r.attributeName ?? '').startsWith('data-mx-'),
        );
        if (meaningful) arm(EDIT_RECAPTURE_MS);
      });
      mo.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
    }
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      ro?.disconnect();
      try { mo?.disconnect(); } catch { /* iframe realm already gone */ }
    };
  }, [enabled, slides, frame, renderKey]);

  return thumbs;
}
