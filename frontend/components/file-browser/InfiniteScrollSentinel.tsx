'use client';

import { useEffect, useRef } from 'react';
import { Box } from '@chakra-ui/react';

/**
 * A 1px marker that calls `onVisible` when it scrolls into view (via IntersectionObserver), used to
 * trigger "load more" for infinite scroll. Observes against the viewport by default; pass `root` for
 * a scroll container. `disabled` (e.g. no more pages / currently loading) stops observing.
 */
export function InfiniteScrollSentinel({
  onVisible,
  disabled = false,
  root = null,
  rootMargin = '200px',
}: {
  onVisible: () => void;
  disabled?: boolean;
  root?: Element | null;
  rootMargin?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled) return;
    const el = ref.current;
    // IntersectionObserver is absent in SSR / jsdom — degrade to no auto-load (manual scroll still works).
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) onVisible(); },
      { root, rootMargin },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [disabled, root, rootMargin, onVisible]);

  return <Box ref={ref} h="1px" aria-hidden />;
}
