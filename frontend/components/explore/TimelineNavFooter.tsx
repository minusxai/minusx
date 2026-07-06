'use client';

import React from 'react';
import { Box, HStack, Text } from '@chakra-ui/react';
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu';
import type { TimelineNode } from './agentTurnTimeline';

interface TimelineNavFooterProps {
  safeIdx: number;
  timeline: TimelineNode[];
  setSelectedIdx: (idx: number) => void;
}

/** Bottom prev/next nav bar — shared across both compact and full layouts. */
export default function TimelineNavFooter({ safeIdx, timeline, setSelectedIdx }: TimelineNavFooterProps) {
  return (
    <HStack
      justify="space-between"
      px={3} py={1.5}
      borderTop="1px solid"
      borderColor="border.default"
    >
      <Box
        as="button"
        aria-label="Previous tool"
        onClick={() => safeIdx > 0 && setSelectedIdx(safeIdx - 1)}
        display="flex" alignItems="center" gap={1}
        cursor={safeIdx > 0 ? 'pointer' : 'default'}
        opacity={safeIdx > 0 ? 1 : 0.3}
        _hover={safeIdx > 0 ? { color: 'accent.teal' } : {}}
        transition="all 0.15s"
        color="fg.subtle"
      >
        <LuChevronLeft size={14} />
        <Text fontSize="2xs" fontFamily="mono" fontWeight="500">
          {safeIdx > 0 ? timeline[safeIdx - 1].verb : 'Prev'}
        </Text>
      </Box>
      <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">
        {safeIdx + 1} / {timeline.length}
      </Text>
      <Box
        as="button"
        aria-label="Next tool"
        onClick={() => safeIdx < timeline.length - 1 && setSelectedIdx(safeIdx + 1)}
        display="flex" alignItems="center" gap={1}
        cursor={safeIdx < timeline.length - 1 ? 'pointer' : 'default'}
        opacity={safeIdx < timeline.length - 1 ? 1 : 0.3}
        _hover={safeIdx < timeline.length - 1 ? { color: 'accent.teal' } : {}}
        transition="all 0.15s"
        color="fg.subtle"
      >
        <Text fontSize="2xs" fontFamily="mono" fontWeight="500">
          {safeIdx < timeline.length - 1 ? timeline[safeIdx + 1].verb : 'Next'}
        </Text>
        <LuChevronRight size={14} />
      </Box>
    </HStack>
  );
}
