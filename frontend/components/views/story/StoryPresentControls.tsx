'use client';

/**
 * Present-mode slide controls — the prev/next buttons, position counter, and keyboard
 * paging while a `<SlideDeck>` story is fullscreen (PresentationContext). ONLY the pill:
 * a slide list during presentation (overlay and sidebar variants) was tried and removed —
 * nothing may compete with the slides. Renders in the PARENT document but inside the
 * fullscreen container's subtree (a fixed element outside it would be hidden by the top
 * layer); `position: fixed` is fine here — the foreignObject restriction applies only
 * inside the story surface.
 *
 * Keyboard listeners attach to the top document AND the story iframe's document: iframe
 * events never bubble to the parent, and focus routinely lands inside the iframe (a click
 * on a slide). The editable-target guard is duck-typed, not `instanceof` — an event from
 * the iframe realm fails a parent-realm instanceof by construction.
 */
import { useEffect } from 'react';
import { Box, IconButton } from '@chakra-ui/react';
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu';

import type { SlideNav } from '@/lib/story-ui/use-slide-nav';

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(el.closest('[contenteditable=""], [contenteditable="true"]'));
}

export default function StoryPresentControls({ nav }: { nav: SlideNav }) {
  const { slides, frame, activeIndex, goTo, next, prev } = nav;

  useEffect(() => {
    if (slides.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
          e.preventDefault();
          next();
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
          e.preventDefault();
          prev();
          break;
        case 'Home':
          e.preventDefault();
          goTo(0);
          break;
        case 'End':
          e.preventDefault();
          goTo(slides.length - 1);
          break;
      }
    };
    const targets: Document[] = [document];
    const idoc = frame?.contentDocument;
    if (idoc) targets.push(idoc);
    targets.forEach((t) => t.addEventListener('keydown', onKey));
    return () => targets.forEach((t) => t.removeEventListener('keydown', onKey));
  }, [slides, frame, next, prev, goTo]);

  if (slides.length === 0) return null;
  return (
    <Box
      position="fixed"
      bottom="6"
      left="50%"
      transform="translateX(-50%)"
      zIndex={20}
      display="flex"
      alignItems="center"
      gap="1"
      px="2"
      py="1"
      borderRadius="full"
      bg="blackAlpha.700"
      color="white"
      boxShadow="lg"
    >
      <IconButton
        aria-label="Previous slide"
        size="sm"
        variant="ghost"
        color="white"
        onClick={prev}
        disabled={activeIndex <= 0}
      >
        <LuChevronLeft />
      </IconButton>
      <Box aria-label="Slide position" fontSize="sm" fontVariantNumeric="tabular-nums" px="1">
        {activeIndex + 1} / {slides.length}
      </Box>
      <IconButton
        aria-label="Next slide"
        size="sm"
        variant="ghost"
        color="white"
        onClick={next}
        disabled={activeIndex >= slides.length - 1}
      >
        <LuChevronRight />
      </IconButton>
    </Box>
  );
}
