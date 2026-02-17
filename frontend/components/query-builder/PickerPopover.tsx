/**
 * PickerPopover - Shared popover components for query builder dropdowns
 * Composable building blocks: PickerPopover, PickerHeader, PickerList, PickerItem
 */

'use client';

import React, { useState } from 'react';
import { Box, Text, HStack, VStack, Input, Popover, Portal } from '@chakra-ui/react';
import { LuSearch } from 'react-icons/lu';

/* ─── PickerPopover ─── */

interface PickerPopoverProps {
  open: boolean;
  onOpenChange: (details: { open: boolean }) => void;
  trigger: React.ReactNode;
  width?: string;
  padding?: number;
  positioning?: Popover.RootProps['positioning'];
  children: React.ReactNode;
}

export function PickerPopover({
  open,
  onOpenChange,
  trigger,
  width = '280px',
  padding = 2,
  positioning,
  children,
}: PickerPopoverProps) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange} positioning={positioning}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content
            width={width}
            bg="bg.elevated"
            // borderColor="border.default"
            // border="1px solid"
            p={0}
            overflow="hidden"
            borderRadius="lg"
          >
            <Popover.Body p={padding} bg="bg.elevated">
              {children}
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}

/* ─── PickerHeader ─── */

export function PickerHeader({ children }: { children: React.ReactNode }) {
  return (
    <Text
      fontSize="xs"
      fontWeight="600"
      color="fg.muted"
      textTransform="uppercase"
      px={2}
      py={1.5}
    >
      {children}
    </Text>
  );
}

/* ─── PickerList ─── */

/**
 * PickerList - Scrollable list container with optional search.
 *
 * When `searchable` is true, pass children as a render function:
 *   <PickerList searchable>{(query) => items.filter(...).map(...)}</PickerList>
 *
 * Otherwise, pass children normally:
 *   <PickerList><PickerItem>...</PickerItem></PickerList>
 */
export function PickerList({
  children,
  maxH,
  searchable,
  searchPlaceholder = 'Search...',
}: {
  children: React.ReactNode | ((searchQuery: string) => React.ReactNode);
  maxH?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const [searchQuery, setSearchQuery] = useState('');

  const rendered = typeof children === 'function' ? children(searchQuery) : children;

  // Check if render function returned empty (null, empty array, etc.)
  const isEmpty = Array.isArray(rendered)
    ? rendered.filter(Boolean).length === 0
    : !rendered;

  return (
    <>
      {searchable && (
        <Box px={1} pb={1.5}>
          <HStack
            gap={2}
            px={3}
            bg="bg.subtle"
            border="1px solid"
            borderColor="border.default"
            borderRadius="md"
            h="32px"
            _focusWithin={{
              borderColor: 'accent.teal',
              boxShadow: '0 0 0 1px var(--chakra-colors-accent-teal)',
            }}
            transition="all 0.2s"
          >
            <Box color="fg.muted" flexShrink={0}>
              <LuSearch size={14} />
            </Box>
            <Input
              size="xs"
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
              bg="transparent"
              border="none"
              fontSize="sm"
              px={0}
              h="auto"
              _focus={{ outline: 'none', boxShadow: 'none' }}
              _placeholder={{ color: 'fg.muted' }}
            />
          </HStack>
        </Box>
      )}
      <VStack gap={0.5} align="stretch" maxH={maxH} overflowY={maxH ? 'auto' : undefined}>
        {isEmpty && searchQuery ? (
          <Text fontSize="xs" color="fg.muted" px={2} py={2} textAlign="center">
            No results for &ldquo;{searchQuery}&rdquo;
          </Text>
        ) : (
          rendered
        )}
      </VStack>
    </>
  );
}

/* ─── PickerItem ─── */

interface PickerItemProps {
  icon?: React.ReactNode;
  children: React.ReactNode;
  selected?: boolean;
  selectedBg?: string;
  onClick?: (e: React.MouseEvent) => void;
  rightElement?: React.ReactNode;
}

export function PickerItem({
  icon,
  children,
  selected,
  selectedBg = 'rgba(99, 102, 241, 0.15)',
  onClick,
  rightElement,
}: PickerItemProps) {
  const content =
    typeof children === 'string' ? (
      <Text fontSize="sm">{children}</Text>
    ) : (
      children
    );

  return (
    <Box
      px={2}
      py={1.5}
      borderRadius="md"
      cursor="pointer"
      bg={selected ? selectedBg : 'transparent'}
      _hover={{ bg: 'bg.muted' }}
      onClick={onClick}
    >
      {icon || rightElement ? (
        <HStack gap={2} justify={rightElement ? 'space-between' : undefined}>
          <HStack gap={2}>
            {icon && <Box color="fg.muted">{icon}</Box>}
            {content}
          </HStack>
          {rightElement}
        </HStack>
      ) : (
        content
      )}
    </Box>
  );
}
