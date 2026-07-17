'use client';

/**
 * VizPanel — the third column of the question surface, shown for ALL
 * questions (semantic and raw SQL alike): a slim header over the full chart
 * config (type selector + axis/config panels, supplied by the parent as
 * children). There are NO tabs here — the query itself already lives in the
 * left GUI/SQL column. The panel is a FIXED-width column (not draggable), so
 * collapsing lives on the header's own chevron rather than a resize handle.
 *
 * The panel is a SHELL: it owns no viz state. The parent (QuestionViewV2)
 * keeps every VizConfigPanel handler exactly where it already lives and
 * passes the assembled config block down as children, so adding a viz
 * setting never touches this file.
 */

import React from 'react';
import { Box, HStack, Text } from '@chakra-ui/react';
import { LuChartColumn, LuChevronRight } from 'react-icons/lu';

interface VizPanelProps {
  /** Optional control rendered at the header's right edge (e.g. the Auto chart-type badge). */
  headerExtra?: React.ReactNode;
  /** Collapse the panel to its slim strip. When omitted, no collapse chevron is shown. */
  onCollapse?: () => void;
  /** The full chart config block, assembled by the parent. */
  children: React.ReactNode;
}

export function VizPanel({ headerExtra, onCollapse, children }: VizPanelProps) {
  return (
    <Box aria-label="Viz panel" h="100%" display="flex" flexDirection="column" minH={0}>
      <HStack px={3} py={1.5} gap={1.5} flexShrink={0} borderBottom="1px solid" borderColor="border.muted" bg="bg.muted">
        <LuChartColumn size={12} color="var(--chakra-colors-accent-teal)" />
        <Text fontSize="2xs" fontWeight="700" letterSpacing="0.08em" textTransform="uppercase" color="fg.muted">
          Viz Settings
        </Text>
        {headerExtra && <Box ml="auto">{headerExtra}</Box>}
        {onCollapse && (
          <Box
            as="button"
            ml={headerExtra ? 0 : 'auto'}
            display="flex"
            alignItems="center"
            justifyContent="center"
            p={0.5}
            borderRadius="sm"
            color="fg.muted"
            cursor="pointer"
            aria-label="Collapse viz panel"
            onClick={onCollapse}
            _hover={{ bg: 'bg.emphasized', color: 'fg.default' }}
          >
            <LuChevronRight size={14} />
          </Box>
        )}
      </HStack>
      <Box flex={1} overflowY="auto" minH={0}>
        {children}
      </Box>
    </Box>
  );
}
