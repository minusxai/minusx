'use client';

import { useState } from 'react';
import { Box, Text, HStack, Icon, Menu, VStack, Spinner } from '@chakra-ui/react';
import { LuChevronDown, LuBadgeCheck, LuCheck } from 'react-icons/lu';
import type { IconType } from 'react-icons';

export interface SelectorOption {
  value: string;
  label: string;
  subtitle?: string;
  icon?: IconType;
  showCheckmark?: boolean;
}

interface GenericSelectorProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectorOption[];
  loading?: boolean;
  placeholder?: string;
  emptyMessage?: string;
  singleOptionLabel?: string;  // When only 1 option, show this as non-interactive indicator
  defaultIcon?: IconType;
  size?: 'sm' | 'md';
  color?: string;  // Used for border and icon
  label?: string;  // aria-label for the trigger element
  compact?: boolean;  // Show as small icon-only indicator with expand on hover
  compactLabel?: string;  // Prefix label shown in compact mode (e.g., "Database")
}

/** Compact mode — icon + tiny badge at rest, label expands on hover or while menu is open */
function CompactSelector({
  value,
  onChange,
  options,
  loading = false,
  placeholder = 'Select...',
  emptyMessage,
  defaultIcon,
  label,
  compactLabel,
}: Pick<GenericSelectorProps, 'value' | 'onChange' | 'options' | 'loading' | 'placeholder' | 'emptyMessage' | 'defaultIcon' | 'color' | 'label' | 'compactLabel'>) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Keep label expanded briefly after menu closes so user sees the update
  const [recentlyClosed, setRecentlyClosed] = useState(false);
  const selectedOption = options.find(opt => opt.value === value);

  const itemName = loading ? 'Loading...'
    : options.length === 0 ? (emptyMessage || 'Not available')
    : selectedOption?.label || options[0]?.label || placeholder || 'Select...';
  const displayLabel = compactLabel ? `${compactLabel}: ${itemName}` : itemName;

  const isConnected = !loading && options.length > 0;
  const hasDropdown = !loading && options.length > 1;

  const expanded = menuOpen || recentlyClosed;
  const expandedStyle = expanded ? { maxWidth: '200px', opacity: 1 } : undefined;

  const pill = (
    <HStack
      gap={1}
      px={1.5}
      py={0.5}
      borderRadius="md"
      cursor={hasDropdown ? 'pointer' : 'default'}
      transition="background 0.15s ease"
      aria-label={label}
      _hover={{ bg: 'bg.muted' }}
      role="group"
    >
      {loading ? (
        <Spinner size="xs" colorPalette="gray" />
      ) : (
        <Box position="relative" flexShrink={0}>
          <Icon as={defaultIcon || LuCheck} boxSize={3.5} color={isConnected ? 'fg.muted' : 'fg.subtle'} />
          {isConnected && (
            <Box
              position="absolute"
              bottom="2px"
              right="-2px"
              w="9px"
              h="9px"
              borderRadius="full"
              bg="accent.teal"
              display="flex"
              alignItems="center"
              justifyContent="center"
            >
              <Icon as={LuCheck} boxSize={2} color="bg.panel" strokeWidth={3} />
            </Box>
          )}
        </Box>
      )}
      <Box
        maxW="0px"
        overflow="hidden"
        opacity={0}
        transition="max-width 0.2s ease, opacity 0.15s ease"
        whiteSpace="nowrap"
        css={{ '[role=group]:hover &': { maxWidth: '200px', opacity: 1 } }}
        style={expandedStyle}
      >
        <Text fontSize="xs" color="fg.muted" fontWeight="500" pr={0.5}>
          {displayLabel}
        </Text>
      </Box>
      {hasDropdown && (
        <Icon
          as={LuChevronDown}
          boxSize={3}
          color="fg.subtle"
          flexShrink={0}
          opacity={0}
          transition="opacity 0.15s ease"
          css={{ '[role=group]:hover &': { opacity: 1 } }}
          style={expanded ? { opacity: 1 } : undefined}
        />
      )}
    </HStack>
  );

  if (!hasDropdown) return pill;

  return (
    <Menu.Root
      open={menuOpen}
      onOpenChange={(e) => {
        setMenuOpen(e.open);
        if (!e.open) {
          // Keep label visible briefly after close so user sees the selection
          setRecentlyClosed(true);
          setTimeout(() => setRecentlyClosed(false), 1500);
        }
      }}
    >
      <Menu.Trigger asChild>
        {pill}
      </Menu.Trigger>
      <Menu.Positioner zIndex={2000}>
        <Menu.Content
          minW="200px"
          maxW="360px"
          bg="bg.surface"
          borderColor="border.default"
          shadow="lg"
          py={1}
          px={0}
        >
          {options.map((option) => (
            <Menu.Item
              key={option.value}
              value={option.value}
              px={3}
              py={1.5}
              cursor="pointer"
              bg={option.value === value ? 'bg.muted' : 'transparent'}
              _hover={{ bg: 'bg.emphasis' }}
              onClick={() => onChange(option.value)}
            >
              <HStack gap={1.5} justify="space-between" w="100%">
                <HStack gap={1.5} minW={0} flex={1}>
                  {(option.icon || defaultIcon) && (
                    <Icon
                      as={option.icon || defaultIcon}
                      boxSize={3.5}
                      color={option.value === value ? 'fg' : 'fg.muted'}
                      flexShrink={0}
                    />
                  )}
                  <Text
                    fontSize="xs"
                    fontWeight={option.value === value ? '600' : '400'}
                    whiteSpace="nowrap"
                    overflow="hidden"
                    textOverflow="ellipsis"
                  >
                    {option.label}
                  </Text>
                  {option.subtitle && (
                    <Text
                      fontSize="2xs"
                      color="fg.muted"
                      fontFamily="mono"
                      textTransform="uppercase"
                      whiteSpace="nowrap"
                    >
                      ({option.subtitle})
                    </Text>
                  )}
                </HStack>
                {option.value === value && (
                  <Icon as={LuCheck} boxSize={3.5} color="fg.muted" flexShrink={0} strokeWidth={2.5} />
                )}
              </HStack>
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Positioner>
    </Menu.Root>
  );
}

export default function GenericSelector({
  value,
  onChange,
  options,
  loading = false,
  placeholder = 'Select...',
  emptyMessage = 'No options available',
  singleOptionLabel,
  defaultIcon,
  size = 'sm',
  color = 'accent.secondary',
  label,
  compact = false,
  compactLabel,
}: GenericSelectorProps) {
  // Find the selected option to display
  const selectedOption = options.find(opt => opt.value === value);

  // Size-based styles
  const sizeStyles = size === 'sm' ? {
    px: 2,
    py: 1.5,
    iconSize: 3.5,
    fontSize: 'xs',
    gap: 1.5,
  } : {
    px: 3,
    py: 2,
    iconSize: 4,
    fontSize: 'sm',
    gap: 2,
  };

  // Common truncation styles
  const truncateStyles = {
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
  };

  // Compact mode — icon + badge at rest, expands label on hover / menu open
  if (compact) {
    return (
      <CompactSelector
        value={value}
        onChange={onChange}
        options={options}
        loading={loading}
        placeholder={placeholder}
        emptyMessage={emptyMessage}
        defaultIcon={defaultIcon}
        color={color}
        label={label}
        compactLabel={compactLabel}
      />
    );
  }

  // Loading state
  if (loading) {
    return (
      <Box
        px={sizeStyles.px}
        py={sizeStyles.py}
        borderRadius="md"
        border="1px solid"
        borderColor="border.default"
        bg="bg.muted"
      >
        <HStack gap={sizeStyles.gap}>
          <Spinner size="sm" colorPalette="gray" />
          <Text fontSize={sizeStyles.fontSize} color="fg.muted" fontWeight="500" {...truncateStyles}>
            Loading...
          </Text>
        </HStack>
      </Box>
    );
  }

  // Empty state
  if (options.length === 0) {
    return (
      <Box
        px={sizeStyles.px}
        py={sizeStyles.py}
        borderRadius="md"
        border="1px solid"
        borderColor="border.default"
        bg="bg.muted"
      >
        <HStack gap={sizeStyles.gap}>
          {defaultIcon && <Icon as={defaultIcon} boxSize={sizeStyles.iconSize} color="fg.muted" />}
          <Text fontSize={sizeStyles.fontSize} color="fg.muted" fontWeight="500" {...truncateStyles}>
            {emptyMessage}
          </Text>
        </HStack>
      </Box>
    );
  }

  // Single option - show non-interactive indicator
  if (options.length === 1 && singleOptionLabel) {
    return (
      <Box
        px={sizeStyles.px}
        py={sizeStyles.py}
        borderRadius="md"
        border="1px solid"
        borderColor={color}
        bg="bg.panel"
        display={"flex"}
        aria-label={label}
      >
        <HStack gap={sizeStyles.gap} align="center">
          <Box w={2} h={2} borderRadius="full" bg={color} />
          {defaultIcon && <Icon as={defaultIcon} boxSize={sizeStyles.iconSize} color={color} />}
          <Text fontSize={sizeStyles.fontSize} color={color} fontWeight="500" {...truncateStyles}>
            {singleOptionLabel}
          </Text>
        </HStack>
      </Box>
    );
  }

  // Multiple options - show dropdown
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Box
          px={sizeStyles.px}
          py={sizeStyles.py}
          borderRadius="md"
          border="1px solid"
          borderColor={color}
          cursor="pointer"
          _hover={{ bg: 'bg.muted', borderColor: color }}
          transition="all 0.2s"
          w="100%"
          aria-label={label}
        >
          <HStack gap={sizeStyles.gap} justify="space-between">
            <HStack gap={sizeStyles.gap} flex={1} minW={0} overflow="hidden">
              {(selectedOption?.icon || defaultIcon) && (
                <Icon as={selectedOption?.icon || defaultIcon} boxSize={sizeStyles.iconSize} color={color} flexShrink={0} />
              )}
              {selectedOption ? (
                <Text fontSize={sizeStyles.fontSize} fontWeight="500" {...truncateStyles} minW={0} flex={1}>
                  {selectedOption.label}
                  {selectedOption.subtitle && (
                    <Text
                      as="span"
                      fontSize="2xs"
                      color="fg.muted"
                      fontFamily="mono"
                      textTransform="uppercase"
                      ml={1}
                    >
                      ({selectedOption.subtitle})
                    </Text>
                  )}
                </Text>
              ) : (
                <Text fontSize={sizeStyles.fontSize} color="fg.muted" {...truncateStyles}>{placeholder}</Text>
              )}
              {selectedOption?.showCheckmark && (
                <HStack gap={1} flexShrink={0}>
                  <Icon as={LuBadgeCheck} boxSize={sizeStyles.iconSize} color="fg.muted" />
                  <Text fontSize="2xs" color="fg.muted" fontWeight="500" {...truncateStyles}>Published</Text>
                </HStack>
              )}
            </HStack>
            <Icon as={LuChevronDown} boxSize={sizeStyles.iconSize} color="fg.subtle" />
          </HStack>
        </Box>
      </Menu.Trigger>
      <Menu.Positioner zIndex={2000}>
        <Menu.Content
          minW={size === 'sm' ? '240px' : '320px'}
          maxW={size === 'sm' ? '400px' : '500px'}
          bg="bg.surface"
          borderColor="border.default"
          shadow="lg"
          p={0}
        >
          <VStack gap={0} align="stretch">
            <Box p={size === 'sm' ? 1.5 : 2}>
              {options.length === 0 ? (
                <Box px={size === 'sm' ? 2 : 2} py={size === 'sm' ? 1.5 : 2}>
                  <Text fontSize={sizeStyles.fontSize} color="fg.muted" {...truncateStyles}>{emptyMessage}</Text>
                </Box>
              ) : (
                <VStack gap={size === 'sm' ? 0.5 : 1} align="stretch">
                  {options.map((option) => (
                    <Box
                      key={option.value}
                      cursor="pointer"
                      borderRadius="sm"
                      px={size === 'sm' ? 2 : 3}
                      py={size === 'sm' ? 1.5 : 2}
                      bg={option.value === value ? `${color}/10` : 'transparent'}
                      _hover={{ bg: option.value === value ? `${color}/20` : 'bg.muted' }}
                      onClick={() => onChange(option.value)}
                    >
                      <HStack gap={sizeStyles.gap} justify="space-between">
                        <HStack gap={sizeStyles.gap}>
                          {(option.icon || defaultIcon) && (
                            <Icon
                              as={option.icon || defaultIcon}
                              boxSize={sizeStyles.iconSize}
                              color={option.value === value ? color : 'fg.muted'}
                            />
                          )}
                          <Text fontSize={sizeStyles.fontSize} fontWeight={option.value === value ? '600' : '400'} {...truncateStyles}>
                            {option.label}
                          </Text>
                          {option.subtitle && (
                            <Text
                              fontSize="2xs"
                              color="fg.muted"
                              fontFamily="mono"
                              textTransform="uppercase"
                              {...truncateStyles}
                            >
                              ({option.subtitle})
                            </Text>
                          )}
                        </HStack>
                        {option.showCheckmark && (
                          <HStack gap={1} flexShrink={0}>
                            <Icon as={LuBadgeCheck} boxSize={sizeStyles.iconSize} color={color} />
                            <Text fontSize="2xs" color={color} fontWeight="500" {...truncateStyles}>Published</Text>
                          </HStack>
                        )}
                      </HStack>
                    </Box>
                  ))}
                </VStack>
              )}
            </Box>
          </VStack>
        </Menu.Content>
      </Menu.Positioner>
    </Menu.Root>
  );
}
