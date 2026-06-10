'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, HStack, VStack, Text, IconButton, Button } from '@chakra-ui/react';
import { LuTrash2, LuPresentation, LuChevronLeft, LuChevronRight, LuX, LuPlay, LuLayoutTemplate } from 'react-icons/lu';

import { DeckSlide } from '@/lib/types';
import SlideHtml from './SlideHtml';
import ScaledSlideFrame from './ScaledSlideFrame';

const STAGE_MAX_W = 960;

export interface DeckChange {
  deck: DeckSlide[];
}

interface DeckViewProps {
  deck: DeckSlide[];
  editMode: boolean;
  onChange: (changes: DeckChange) => void;
}

/**
 * Presentation view: a deck of agent-authored HTML slides. v0 is a viewer —
 * slides are written/edited by the agent (via EditFile on the dashboard's
 * `deck`); in-app edit mode only allows deleting slides.
 */
export default function DeckView({ deck, editMode, onChange }: DeckViewProps) {
  // Tolerate legacy structured-format slides (pre-HTML): keep only HTML slides.
  const slides = useMemo<DeckSlide[]>(
    () => (deck || []).filter(s => typeof s?.html === 'string'),
    [deck],
  );
  const [activeIdx, setActiveIdx] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const safeIdx = Math.min(activeIdx, Math.max(0, slides.length - 1));

  const rootRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState('100%');
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const compute = () => setContainerHeight(`${Math.max(420, window.innerHeight - el.getBoundingClientRect().top)}px`);
    compute();
    const raf = requestAnimationFrame(compute);
    window.addEventListener('resize', compute);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', compute); };
  }, [slides.length === 0]);

  const deleteSlide = useCallback((idx: number) => {
    onChange({ deck: slides.filter((_, i) => i !== idx) });
    setActiveIdx(i => Math.max(0, Math.min(i, slides.length - 2)));
  }, [slides, onChange]);

  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPresenting(false);
      else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, slides.length - 1)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presenting, slides.length]);

  if (slides.length === 0) {
    return (
      <Box ref={rootRef} aria-label="No slides" height={containerHeight} p={10} display="flex" flexDirection="column" alignItems="center" justifyContent="center">
        <Box mb={3} opacity={0.3}><LuPresentation size={64} strokeWidth={1.5} /></Box>
        <Text fontSize="lg" fontWeight={700} color="fg.default">No slides yet</Text>
        <Text fontSize="sm" color="fg.muted" mt={1}>Ask the agent to build a deck from this dashboard.</Text>
      </Box>
    );
  }

  const activeSlide = slides[safeIdx];

  return (
    <HStack ref={rootRef} align="stretch" gap={0} height={containerHeight}>
      {/* Slide rail */}
      <VStack align="stretch" gap={2} w="200px" flexShrink={0} p={3} borderRightWidth="1px" borderColor="border.muted" overflowY="auto" bg="bg.subtle">
        {slides.map((slide, idx) => (
          <HStack key={slide.id} gap={1.5} align="center" role="group">
            <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" w="14px" textAlign="right" flexShrink={0}>{idx + 1}</Text>
            <Box
              flex={1}
              minW={0}
              position="relative"
              bg="bg.surface"
              borderWidth="2px"
              borderColor={idx === safeIdx ? 'accent.teal' : 'border.default'}
              borderRadius="md"
              overflow="hidden"
              _hover={{ borderColor: idx === safeIdx ? 'accent.teal' : 'accent.teal/40' }}
              transition="border-color 0.12s"
            >
              <ScaledSlideFrame>
                <SlideHtml html={slide.html} />
              </ScaledSlideFrame>
              {/* Transparent click overlay — the slide HTML must NOT live
                  inside the <button>: UA button styles (font, text-align)
                  don't inherit and would change its layout vs the stage. */}
              <Box
                as="button"
                aria-label={`Slide ${idx + 1}`}
                onClick={() => setActiveIdx(idx)}
                position="absolute"
                inset={0}
                w="100%"
                h="100%"
                cursor="pointer"
                bg="transparent"
              />
            </Box>
            {editMode && (
              <IconButton aria-label={`Delete slide ${idx + 1}`} size="2xs" variant="ghost" color="fg.subtle" opacity={0} _groupHover={{ opacity: 1 }} _hover={{ color: 'accent.danger' }} onClick={() => deleteSlide(idx)} flexShrink={0}>
                <LuTrash2 size={12} />
              </IconButton>
            )}
          </HStack>
        ))}
      </VStack>

      {/* Stage */}
      <VStack flex={1} minW={0} align="stretch" gap={0} bg="bg.canvas" overflow="auto">
        <HStack justify="space-between" px={3} py={1.5} borderBottomWidth="1px" borderColor="border.muted" bg="bg.surface" flexShrink={0} minH="44px">
          <Button
            aria-label="Add template"
            size="2xs"
            px={3}
            gap={1.5}
            h="28px"
            fontWeight={700}
            borderRadius="md"
            bg="accent.teal"
            color="white"
            boxShadow="xs"
            _hover={{ bg: 'accent.teal/85' }}
            _active={{ bg: 'accent.teal/90' }}
          >
            <LuLayoutTemplate size={13} /> Add template
          </Button>
          <Button
            size="2xs"
            onClick={() => setPresenting(true)}
            aria-label="Present"
            px={3}
            gap={1.5}
            h="28px"
            fontWeight={700}
            borderRadius="md"
            bg="accent.teal"
            color="white"
            boxShadow="xs"
            _hover={{ bg: 'accent.teal/85' }}
            _active={{ bg: 'accent.teal/90' }}
          >
            <LuPlay size={12} fill="currentColor" /> Present
          </Button>
        </HStack>

        <Box flex={1} display="flex" alignItems="flex-start" justifyContent="safe center" p={6}>
          <Box aria-label="Slide stage" w="100%" maxW={`${STAGE_MAX_W}px`} borderWidth="1px" borderColor="border.default" borderRadius="md" boxShadow="0 1px 3px rgba(0,0,0,0.06)" overflow="hidden">
            <ScaledSlideFrame>
              <SlideHtml key={activeSlide.id} html={activeSlide.html} />
            </ScaledSlideFrame>
          </Box>
        </Box>
      </VStack>

      {/* Fullscreen presenter */}
      {presenting && (
        <Box aria-label="Presentation" position="fixed" inset={0} zIndex={9999} bg="#0b0d10" display="flex" flexDirection="column" alignItems="center" justifyContent="center" p={8}>
          <Box w="100%" maxW="1280px" borderRadius="lg" overflow="hidden" boxShadow="0 20px 60px rgba(0,0,0,0.5)">
            <ScaledSlideFrame>
              <SlideHtml key={activeSlide.id} html={activeSlide.html} />
            </ScaledSlideFrame>
          </Box>
          <HStack position="absolute" bottom={6} left="50%" transform="translateX(-50%)" gap={3} bg="rgba(255,255,255,0.1)" px={4} py={2} borderRadius="full" backdropFilter="blur(8px)">
            <IconButton aria-label="Previous slide" size="xs" variant="ghost" color="white" disabled={safeIdx === 0} onClick={() => setActiveIdx(i => Math.max(0, i - 1))}><LuChevronLeft size={16} /></IconButton>
            <Text fontSize="xs" color="white" fontFamily="mono">{safeIdx + 1} / {slides.length}</Text>
            <IconButton aria-label="Next slide" size="xs" variant="ghost" color="white" disabled={safeIdx === slides.length - 1} onClick={() => setActiveIdx(i => Math.min(slides.length - 1, i + 1))}><LuChevronRight size={16} /></IconButton>
            <Box w="1px" h="16px" bg="whiteAlpha.400" />
            <IconButton aria-label="Exit presentation" size="xs" variant="ghost" color="white" onClick={() => setPresenting(false)}><LuX size={16} /></IconButton>
          </HStack>
        </Box>
      )}
    </HStack>
  );
}
