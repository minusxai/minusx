'use client';

import { useEffect, useRef, useState } from 'react';
import { Box } from '@chakra-ui/react';

import { SLIDE_W, SLIDE_H } from './SlideHtml';

/**
 * Scales a fixed 1280×720 slide to fill its container (16:9, width-driven) —
 * the same transform trick the old thumbnail rail used, generalized so the
 * stage, rail thumbs, and present mode all share one scaler.
 */
export default function ScaledSlideFrame({ children, ariaLabel }: {
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const compute = () => setScale(el.clientWidth / SLIDE_W);
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <Box ref={outerRef} aria-label={ariaLabel} position="relative" w="100%" css={{ aspectRatio: '16 / 9' }} overflow="hidden">
      <Box
        position="absolute"
        top={0}
        left={0}
        width={`${SLIDE_W}px`}
        height={`${SLIDE_H}px`}
        transformOrigin="top left"
        transform={`scale(${scale})`}
      >
        {children}
      </Box>
    </Box>
  );
}
