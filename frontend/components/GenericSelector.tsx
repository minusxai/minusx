'use client';

import { Box, Text, HStack, Icon, Menu, VStack, Spinner } from '@chakra-ui/react';
import { LuChevronDown, LuBadgeCheck } from 'react-icons/lu';
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
  color = 'accent.secondary'
}: GenericSelectorProps) {
  // Find the selected option to display
  const selectedOption = options.find(opt => opt.value === value) || options[0];

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
        >
          <HStack gap={sizeStyles.gap} justify="space-between">
            <HStack gap={sizeStyles.gap} flex={1}>
              {(selectedOption?.icon || defaultIcon) && (
                <Icon as={selectedOption?.icon || defaultIcon} boxSize={sizeStyles.iconSize} color={color} />
              )}
              {selectedOption ? (
                <>
                  <Text fontSize={sizeStyles.fontSize} fontWeight="500" {...truncateStyles}>{selectedOption.label}</Text>
                  {selectedOption.subtitle && (
                    <Text
                      fontSize="2xs"
                      color="fg.muted"
                      fontFamily="mono"
                      textTransform="uppercase"
                      {...truncateStyles}
                    >
                      ({selectedOption.subtitle})
                    </Text>
                  )}
                  {selectedOption.showCheckmark && (
                    <HStack gap={1} flexShrink={0}>
                      <Icon as={LuBadgeCheck} boxSize={sizeStyles.iconSize} color="fg.muted" />
                      <Text fontSize="2xs" color="fg.muted" fontWeight="500" {...truncateStyles}>Published</Text>
                    </HStack>
                  )}
                </>
              ) : (
                <Text fontSize={sizeStyles.fontSize} color="fg.muted" {...truncateStyles}>{placeholder}</Text>
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
