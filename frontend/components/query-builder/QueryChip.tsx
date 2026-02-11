/**
 * QueryChip - Reusable pill/chip component for query builder
 * compact, dismissible chips with color variants
 */

'use client';

import { Box, HStack, Text, IconButton } from '@chakra-ui/react';
import { LuX, LuTable, LuHash, LuCalendar, LuType } from 'react-icons/lu';
import { ReactNode } from 'react';

export type ChipVariant = 'metric' | 'dimension' | 'filter' | 'table' | 'sort' | 'neutral';

interface QueryChipProps {
  children: ReactNode;
  variant?: ChipVariant;
  icon?: ReactNode;
  onRemove?: () => void;
  onClick?: () => void;
  isActive?: boolean;
  size?: 'sm' | 'md';
}

const variantStyles: Record<ChipVariant, { bg: string; border: string; color: string; hoverBg: string }> = {
  metric: {
    bg: 'rgba(134, 239, 172, 0.12)',
    border: 'rgba(134, 239, 172, 0.3)',
    color: '#86efac',
    hoverBg: 'rgba(134, 239, 172, 0.2)',
  },
  dimension: {
    bg: 'rgba(251, 191, 36, 0.1)',
    border: 'rgba(251, 191, 36, 0.28)',
    color: '#fbbf24',
    hoverBg: 'rgba(251, 191, 36, 0.18)',
  },
  filter: {
    bg: 'rgba(147, 197, 253, 0.1)',
    border: 'rgba(147, 197, 253, 0.28)',
    color: '#93c5fd',
    hoverBg: 'rgba(147, 197, 253, 0.18)',
  },
  table: {
    bg: 'rgba(99, 102, 241, 0.12)',
    border: 'rgba(99, 102, 241, 0.3)',
    color: '#a5b4fc',
    hoverBg: 'rgba(99, 102, 241, 0.2)',
  },
  sort: {
    bg: 'rgba(192, 132, 252, 0.1)',
    border: 'rgba(192, 132, 252, 0.28)',
    color: '#c084fc',
    hoverBg: 'rgba(192, 132, 252, 0.18)',
  },
  neutral: {
    bg: 'rgba(148, 163, 184, 0.08)',
    border: 'rgba(148, 163, 184, 0.2)',
    color: '#94a3b8',
    hoverBg: 'rgba(148, 163, 184, 0.15)',
  },
};

export function QueryChip({
  children,
  variant = 'neutral',
  icon,
  onRemove,
  onClick,
  isActive = false,
  size = 'sm',
}: QueryChipProps) {
  const styles = variantStyles[variant];
  const isClickable = !!onClick;

  return (
    <HStack
      bg={isActive ? styles.hoverBg : styles.bg}
      border="1px solid"
      borderColor={styles.border}
      borderRadius="md"
      px={size === 'sm' ? 2 : 2.5}
      py={size === 'sm' ? 1 : 1.5}
      gap={1.5}
      cursor={isClickable ? 'pointer' : 'default'}
      transition="all 0.15s ease"
      _hover={isClickable ? { bg: styles.hoverBg, borderColor: styles.color } : undefined}
      onClick={onClick}
      flexShrink={0}
    >
      {icon && (
        <Box color={styles.color} fontSize={size === 'sm' ? 'xs' : 'sm'} display="flex" alignItems="center">
          {icon}
        </Box>
      )}
      <Text
        fontSize={size === 'sm' ? 'xs' : 'sm'}
        fontWeight="500"
        color={styles.color}
        whiteSpace="nowrap"
        lineHeight="1.2"
      >
        {children}
      </Text>
      {onRemove && (
        <Box
          as="button"
          display="flex"
          alignItems="center"
          justifyContent="center"
          ml={0.5}
          p={0.5}
          borderRadius="sm"
          color={styles.color}
          opacity={0.5}
          _hover={{ opacity: 1, bg: 'rgba(255,255,255,0.1)' }}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <LuX size={12} />
        </Box>
      )}
    </HStack>
  );
}

// Add button styled as chip
interface AddChipButtonProps {
  onClick: () => void;
  variant?: ChipVariant;
  size?: 'sm' | 'md';
}

export function AddChipButton({ onClick, variant = 'neutral', size = 'sm' }: AddChipButtonProps) {
  const styles = variantStyles[variant];

  return (
    <Box
      as="button"
      bg="transparent"
      border="1px dashed"
      borderColor={styles.border}
      borderRadius="md"
      px={size === 'sm' ? 2 : 2.5}
      py={size === 'sm' ? 1 : 1.5}
      cursor="pointer"
      transition="all 0.15s ease"
      _hover={{ bg: styles.bg, borderStyle: 'solid', borderColor: styles.color }}
      onClick={onClick}
      display="flex"
      alignItems="center"
      justifyContent="center"
    >
      <Text fontSize={size === 'sm' ? 'sm' : 'md'} color={styles.color} fontWeight="500" lineHeight="1">
        +
      </Text>
    </Box>
  );
}

// Column type icon helper
export function getColumnIcon(type?: string) {
  if (!type) return <LuType size={12} />;
  const t = type.toLowerCase();
  if (t.includes('int') || t.includes('float') || t.includes('decimal') || t.includes('numeric')) {
    return <LuHash size={12} />;
  }
  if (t.includes('date') || t.includes('time')) {
    return <LuCalendar size={12} />;
  }
  return <LuType size={12} />;
}
