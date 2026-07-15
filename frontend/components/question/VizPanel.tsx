'use client';

/**
 * VizPanel — the third column of the question surface, shown for ALL
 * questions (semantic and raw SQL alike): a slim header over the full chart
 * config (type selector + axis/config panels, supplied by the parent as
 * children). There are NO tabs here — the query itself already lives in the
 * left GUI/SQL column — and no close button: collapsing happens on the
 * resize handle's chevron, like the other columns.
 *
 * The panel is a SHELL: it owns no viz state. The parent (QuestionViewV2)
 * keeps every VizConfigPanel handler exactly where it already lives and
 * passes the assembled config block down as children, so adding a viz
 * setting never touches this file.
 */

import React from 'react';
import { Box, HStack, Text } from '@chakra-ui/react';
import { LuChartColumn } from 'react-icons/lu';

interface VizPanelProps {
  /** Optional control rendered at the header's right edge (e.g. the Auto chart-type badge). */
  headerExtra?: React.ReactNode;
  /** The full chart config block, assembled by the parent. */
  children: React.ReactNode;
}

export function VizPanel({ headerExtra, children }: VizPanelProps) {
  return (
    <Box aria-label="Viz panel" h="100%" display="flex" flexDirection="column" minH={0}>
      <HStack px={3} py={1.5} gap={1.5} flexShrink={0} borderBottom="1px solid" borderColor="border.muted" bg="bg.muted">
        <LuChartColumn size={12} color="var(--chakra-colors-accent-teal)" />
        <Text fontSize="2xs" fontWeight="700" letterSpacing="0.08em" textTransform="uppercase" color="fg.muted">
          Viz Settings
        </Text>
        {headerExtra && <Box ml="auto">{headerExtra}</Box>}
      </HStack>
      <Box flex={1} overflowY="auto" minH={0}>
        {children}
      </Box>
    </Box>
  );
}
