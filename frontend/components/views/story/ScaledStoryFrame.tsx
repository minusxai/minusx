'use client';

import { useEffect, useRef, useState } from 'react';
import { Box } from '@chakra-ui/react';

export const STORY_W = 1280;

/**
 * Scales a fixed 1280px-wide, content-height story canvas to fill its
 * container — the deck's ScaledSlideFrame trick, but with the outer height
 * tracking the (scaled) natural content height so the page scrolls normally
 * instead of clipping to a fixed aspect ratio.
 */
export default function ScaledStoryFrame({ children, ariaLabel }: {
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [contentH, setContentH] = useState(0);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const compute = () => {
      setScale(outer.clientWidth / STORY_W);
      // ResizeObserver reports the layout (untransformed) box — exactly the
      // natural content height we need before scaling.
      setContentH(inner.offsetHeight);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  return (
    <Box
      ref={outerRef}
      aria-label={ariaLabel}
      position="relative"
      w="100%"
      overflow="hidden"
      style={{ height: `${contentH * scale}px` }}
    >
      <Box
        ref={innerRef}
        position="absolute"
        top={0}
        left={0}
        width={`${STORY_W}px`}
        transformOrigin="top left"
        transform={`scale(${scale})`}
      >
        {children}
      </Box>
    </Box>
  );
}
