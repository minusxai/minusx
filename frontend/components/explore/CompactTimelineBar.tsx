'use client';

import React from 'react';
import { Box, HStack, Text, Icon } from '@chakra-ui/react';
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu';
import type { TimelineNode } from './agentTurnTimeline';

interface CompactTimelineBarProps {
  timeline: TimelineNode[];
  safeIdx: number;
  setSelectedIdx: (idx: number) => void;
  activeChipRef: (el: HTMLElement | null) => void;
}

/** Compact (horizontal, scrollable) timeline chip bar — used when isCompact is true. */
export default function CompactTimelineBar({ timeline, safeIdx, setSelectedIdx, activeChipRef }: CompactTimelineBarProps) {
  return (
    <HStack
      bg="bg.elevated"
      borderBottom="1px solid"
      borderColor="border.default"
      px={1} py={1} gap={1}
    >
      <Text
        fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="600"
        textTransform="uppercase" flexShrink={0} pl={1}
      >
        Tools
      </Text>
      {/* Prev chevron */}
      <Box
        as="button"
        aria-label="Previous step"
        onClick={() => safeIdx > 0 && setSelectedIdx(safeIdx - 1)}
        w="20px" h="20px" borderRadius="full"
        bg="accent.teal/15" color="accent.teal"
        display="flex" alignItems="center" justifyContent="center"
        cursor={safeIdx === 0 ? 'default' : 'pointer'}
        opacity={safeIdx === 0 ? 0.3 : 1}
        _hover={safeIdx === 0 ? {} : { bg: 'accent.teal/25' }}
        flexShrink={0}
      >
        <LuChevronLeft size={12} />
      </Box>

      {/* All steps — scroll horizontally if they overflow */}
      <HStack gap={0} flex={1} minW={0} overflowX="auto" flexWrap="nowrap" css={{ scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
        {timeline.map((node, idx) => {
          const isSelected = idx === safeIdx;
          const isLast = idx === timeline.length - 1;

          return (
            <React.Fragment key={idx}>
              <Box
                ref={isSelected ? activeChipRef : undefined}
                as="button"
                aria-label={`${node.verb}${node.count > 1 ? ` ×${node.count}` : ''}`}
                onClick={() => setSelectedIdx(idx)}
                display="flex"
                alignItems="center"
                gap={1}
                px={1.5}
                py={0.5}
                cursor="pointer"
                bg={isSelected ? 'accent.teal/12' : 'transparent'}
                borderRadius="sm"
                _hover={{ bg: isSelected ? 'accent.teal/12' : 'bg.muted' }}
                transition="all 0.1s"
                flexShrink={0}
              >
                <Icon
                  as={node.icon}
                  boxSize={3}
                  color={isSelected ? 'accent.teal' : 'fg.muted'}
                  flexShrink={0}
                />
                <Text
                  fontSize="2xs"
                  fontFamily="mono"
                  color={isSelected ? 'accent.teal' : 'fg.subtle'}
                  fontWeight={isSelected ? '600' : '400'}
                  whiteSpace="nowrap"
                >
                  {node.verb}
                </Text>
                {node.count > 1 && (
                  <Box
                    bg={isSelected ? 'accent.teal/20' : 'bg.muted'}
                    color={isSelected ? 'accent.teal' : 'fg.subtle'}
                    borderRadius="full"
                    px={1}
                    fontSize="2xs"
                    fontFamily="mono"
                    fontWeight="600"
                    lineHeight="1.4"
                    flexShrink={0}
                  >
                    {node.count}
                  </Box>
                )}
              </Box>
              {!isLast && (
                <Text color="border.default" fontSize="xs" flexShrink={0} lineHeight={1}>›</Text>
              )}
            </React.Fragment>
          );
        })}
      </HStack>

      {/* Next chevron */}
      <Box
        as="button"
        aria-label="Next step"
        onClick={() => safeIdx < timeline.length - 1 && setSelectedIdx(safeIdx + 1)}
        w="20px" h="20px" borderRadius="full"
        bg="accent.teal/15" color="accent.teal"
        display="flex" alignItems="center" justifyContent="center"
        cursor={safeIdx >= timeline.length - 1 ? 'default' : 'pointer'}
        opacity={safeIdx >= timeline.length - 1 ? 0.3 : 1}
        _hover={safeIdx >= timeline.length - 1 ? {} : { bg: 'accent.teal/25' }}
        flexShrink={0}
      >
        <LuChevronRight size={12} />
      </Box>
    </HStack>
  );
}
