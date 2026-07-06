'use client';

import React from 'react';
import { Box, VStack, Text, Icon } from '@chakra-ui/react';
import type { TimelineNode } from './agentTurnTimeline';

interface VerticalTimelineRailProps {
  timeline: TimelineNode[];
  safeIdx: number;
  setSelectedIdx: (idx: number) => void;
  rightPaneH: string;
}

/** Full (non-compact) layout's vertical timeline rail, shown beside the detail pane. */
export default function VerticalTimelineRail({ timeline, safeIdx, setSelectedIdx, rightPaneH }: VerticalTimelineRailProps) {
  return (
    <VStack
      flexShrink={0}
      bg="bg.elevated"
      borderRight="1px solid"
      borderColor="border.default"
      py={1}
      gap={0}
      w="170px"
      minW="170px"
      maxH={rightPaneH === 'auto' ? '400px' : rightPaneH}
      overflowY="auto"
    >
      <Text
        fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="600"
        textTransform="uppercase" px={3} pt={1} pb={1.5} w="100%"
      >
        Tools Timeline
      </Text>
      {timeline.map((node, idx) => {
        const isSelected = idx === safeIdx;
        const isFirst = idx === 0;
        const isLast = idx === timeline.length - 1;
        const lineLeft = '15.5px';

        return (
          <Box
            key={idx}
            as="button"
            aria-label={`${node.verb}${node.count > 1 ? ` ×${node.count}` : ''}`}
            onClick={() => setSelectedIdx(idx)}
            display="flex"
            alignItems="center"
            gap={2}
            py={1.5}
            px={3}
            w="100%"
            cursor="pointer"
            bg={isSelected ? 'accent.teal/12' : 'transparent'}
            _hover={{ bg: isSelected ? 'accent.teal/12' : 'bg.muted' }}
            transition="all 0.1s"
            position="relative"
          >
            {!isFirst && (
              <Box position="absolute" left={lineLeft} top={0} h="50%" w="1.5px" bg="border.default" />
            )}
            {!isLast && (
              <Box position="absolute" left={lineLeft} top="50%" h="50%" w="1.5px" bg="border.default" />
            )}
            <Box
              w="8px" h="8px" borderRadius="full"
              bg={isSelected ? 'accent.teal' : 'bg.elevated'}
              border="1.5px solid" borderColor={isSelected ? 'accent.teal' : 'fg.subtle'}
              flexShrink={0} zIndex={1}
            />
            <Icon as={node.icon} boxSize={3} color={isSelected ? 'accent.teal' : 'fg.muted'} flexShrink={0} />
            <Text
              fontSize="xs" fontFamily="mono"
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
                borderRadius="full" px={1.5} py={0}
                fontSize="2xs" fontFamily="mono" fontWeight="600" lineHeight="1.6"
                flexShrink={0}
              >
                {node.count}
              </Box>
            )}
          </Box>
        );
      })}
    </VStack>
  );
}
