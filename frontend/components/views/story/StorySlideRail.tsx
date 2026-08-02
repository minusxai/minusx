'use client';

/**
 * Birds-eye slide rail — the parent-document overview of a story's `<SlideDeck>` while
 * NOT presenting (it stays up during an edit session): content thumbnails (when
 * captured) over numbered slide titles, click to scroll, active slide tracked from
 * scroll position. Pure view over `useSlideNav` / `useSlideThumbnails` (StoryView owns
 * both hooks); renders nothing unless the story actually has a deck (≥2 slides).
 * Thumbnails render only when the capture matches the slide count — anything else falls
 * back to the title list, never a broken strip.
 *
 * With `onRenameSlide` (edit sessions only), each entry grows a rename affordance: an
 * inline input that commits on Enter/blur and cancels on Escape. The rename button is a
 * SIBLING of the navigation button, not a child — nested interactive elements are
 * invalid HTML and unreachable by keyboard.
 */
import { useState } from 'react';
import { Box, IconButton } from '@chakra-ui/react';
import { LuPencil } from 'react-icons/lu';

import type { SlideNav } from '@/lib/story-ui/use-slide-nav';

interface StorySlideRailProps {
  nav: SlideNav;
  /** One JPEG data URL per slide (useSlideThumbnails), or null while not captured. */
  thumbnails?: string[] | null;
  /** Present during an edit session: commit a slide's new title (blank = clear, heading fallback). */
  onRenameSlide?: (index: number, title: string) => void;
}

export default function StorySlideRail({ nav, thumbnails, onRenameSlide }: StorySlideRailProps) {
  const [renaming, setRenaming] = useState<number | null>(null);
  if (nav.slides.length < 2) return null;
  const hasThumbs = !!thumbnails && thumbnails.length === nav.slides.length;
  const commit = (i: number, value: string, current: string) => {
    setRenaming(null);
    if (value.trim() !== current) onRenameSlide?.(i, value);
  };
  return (
    <Box
      as="nav"
      aria-label="Slide overview"
      position="sticky"
      top="20"
      alignSelf="flex-start"
      w="190px"
      flexShrink={0}
      maxH="calc(100vh - 160px)"
      overflowY="auto"
      pr="4"
      display={{ base: 'none', xl: 'block' }}
    >
      {nav.slides.map((s, i) => {
        const active = i === nav.activeIndex;
        const isRenaming = renaming === i;
        return (
          <Box key={i} position="relative" mb={hasThumbs ? '2' : '0.5'}>
            <Box
              as="button"
              aria-label={`Go to slide ${i + 1}: ${s.title}`}
              aria-current={active ? 'true' : undefined}
              onClick={() => nav.goTo(i)}
              display="block"
              w="100%"
              textAlign="left"
              px="2"
              py="1.5"
              borderRadius="md"
              fontSize="xs"
              cursor="pointer"
              color={active ? 'fg' : 'fg.muted'}
              bg={active ? 'bg.muted' : 'transparent'}
              fontWeight={active ? 'semibold' : 'normal'}
              _hover={{ bg: 'bg.muted' }}
            >
              {hasThumbs && (
                <Box
                  as="span"
                  display="block"
                  mb="1.5"
                  borderWidth="1px"
                  borderColor={active ? 'border.emphasized' : 'border'}
                  borderRadius="sm"
                  overflow="hidden"
                  bg="white"
                >
                  {/* Decorative — the button's aria-label already names the slide. */}
                  <img src={thumbnails[i]} alt="" style={{ display: 'block', width: '100%' }} />
                </Box>
              )}
              <Box as="span" display="flex" alignItems="baseline" gap="2" pr={onRenameSlide ? '6' : undefined}>
                <Box as="span" fontVariantNumeric="tabular-nums" color={active ? 'fg' : 'fg.subtle'}>
                  {i + 1}
                </Box>
                <Box as="span" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                  {s.title}
                </Box>
              </Box>
            </Box>
            {onRenameSlide && !isRenaming && (
              <IconButton
                aria-label={`Edit slide ${i + 1} title`}
                size="2xs"
                variant="ghost"
                position="absolute"
                bottom="1"
                right="1"
                color="fg.subtle"
                onClick={() => setRenaming(i)}
              >
                <LuPencil />
              </IconButton>
            )}
            {isRenaming && (
              <Box position="absolute" bottom="0.5" left="1.5" right="1.5" bg="bg" borderRadius="sm">
                <input
                  aria-label={`Slide ${i + 1} title`}
                  defaultValue={s.title}
                  autoFocus
                  style={{ width: '100%', fontSize: '12px', padding: '2px 4px', border: '1px solid var(--chakra-colors-border)', borderRadius: '4px', background: 'inherit', color: 'inherit' }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit(i, (e.target as HTMLInputElement).value, s.title);
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  onBlur={(e) => { if (renaming === i) commit(i, e.target.value, s.title); }}
                />
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
