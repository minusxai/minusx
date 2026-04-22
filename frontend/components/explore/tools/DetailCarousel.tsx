'use client';

import React, { useState } from 'react';
import { Box, HStack, VStack, Text, Icon } from '@chakra-ui/react';
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu';
import type { MessageWithFlags } from '../message/messageHelpers';

// ─── Shared types for detail cards ────────────────────────────────

export interface DetailCardProps {
  msg: MessageWithFlags;
  filesDict: Record<number, any>;
}

// ─── Shared helpers for detail card parsing ───────────────────────

export function parseToolArgs(msg: MessageWithFlags): Record<string, any> {
  const toolMsg = msg as any;
  try {
    return typeof toolMsg.function?.arguments === 'string'
      ? JSON.parse(toolMsg.function.arguments) : toolMsg.function?.arguments || {};
  } catch { return {}; }
}

export function parseToolContent(msg: MessageWithFlags): any {
  const toolMsg = msg as any;
  try {
    return typeof toolMsg.content === 'string' ? JSON.parse(toolMsg.content) : toolMsg.content || {};
  } catch { return {}; }
}

export function isToolSuccess(msg: MessageWithFlags): boolean {
  const toolMsg = msg as any;
  const content = toolMsg.content;
  if (!content || content === '(executing...)') return true;
  try {
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    return parsed.success !== false;
  } catch { return true; }
}

export function getToolNameFromMsg(msg: MessageWithFlags): string {
  if (msg.role !== 'tool') return '';
  return (msg as any).function?.name || '';
}

// ─── DetailCarousel component ─────────────────────────────────────

interface DetailCarouselProps {
  icon: React.ComponentType;
  label: string;
  labelPlural?: string;
  itemCount: number;
  errorCount?: number;
  renderCard: (index: number) => React.ReactNode;
}

export default function DetailCarousel({ icon, label, labelPlural, itemCount, errorCount = 0, renderCard }: DetailCarouselProps) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const safeIdx = Math.min(currentIdx, Math.max(0, itemCount - 1));

  if (itemCount === 0) return null;

  const canPrev = safeIdx > 0;
  const canNext = safeIdx < itemCount - 1;

  return (
    <VStack gap={0} align="stretch">
      <HStack justify="space-between" px={3} pt={2} pb={1}>
        <HStack gap={1.5}>
          <Icon as={icon} boxSize={3} color="fg.muted" />
          <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="600" textTransform="uppercase">
            {itemCount} {itemCount === 1 ? label : (labelPlural || `${label}s`)}
            {errorCount > 0 && (
              <Text as="span" color="accent.danger"> ({errorCount} {errorCount === 1 ? 'error' : 'errors'})</Text>
            )}
          </Text>
        </HStack>
        {itemCount > 1 && (
          <HStack gap={1.5}>
            <Box as="button" aria-label="Previous"
              onClick={() => canPrev && setCurrentIdx(safeIdx - 1)}
              w="24px" h="24px" borderRadius="full"
              bg={canPrev ? 'accent.teal' : 'accent.teal/15'} color={canPrev ? 'white' : 'accent.teal'}
              display="flex" alignItems="center" justifyContent="center"
              cursor={canPrev ? 'pointer' : 'default'}
              opacity={canPrev ? 1 : 0.4}
              _hover={canPrev ? { bg: 'accent.teal', boxShadow: 'sm' } : {}}
              transition="all 0.15s"
            ><LuChevronLeft size={14} /></Box>
            {Array.from({ length: itemCount }).map((_, idx) => (
              <Box key={idx} as="button" aria-label={`Item ${idx + 1}`}
                w={idx === safeIdx ? '16px' : '6px'} h="6px" borderRadius="full"
                bg={idx === safeIdx ? 'accent.teal' : 'border.default'}
                cursor="pointer" transition="all 0.2s" onClick={() => setCurrentIdx(idx)}
              />
            ))}
            <Box as="button" aria-label="Next"
              onClick={() => canNext && setCurrentIdx(safeIdx + 1)}
              w="24px" h="24px" borderRadius="full"
              bg={canNext ? 'accent.teal' : 'accent.teal/15'} color={canNext ? 'white' : 'accent.teal'}
              display="flex" alignItems="center" justifyContent="center"
              cursor={canNext ? 'pointer' : 'default'}
              opacity={canNext ? 1 : 0.4}
              _hover={canNext ? { bg: 'accent.teal', boxShadow: 'sm' } : {}}
              transition="all 0.15s"
            ><LuChevronRight size={14} /></Box>
          </HStack>
        )}
      </HStack>
      {renderCard(safeIdx)}
    </VStack>
  );
}
