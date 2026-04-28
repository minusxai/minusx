'use client';

import { Box, VStack, HStack, SimpleGrid, Text } from '@chakra-ui/react';
import Image from 'next/image';
import { CONNECTION_TYPES, CONNECTION_TYPE_GROUPS } from '@/lib/ui/connection-type-options';
import type { ConnectionTypeOption } from '@/lib/ui/connection-type-options';

interface ConnectionTypePickerProps {
  onSelect: (connType: ConnectionTypeOption) => void;
  disabled?: boolean;
}

/**
 * Grouped connection type picker grid.
 * Shared by the onboarding wizard (StepConnection) and inline create (ConnectionFormV2).
 */
export default function ConnectionTypePicker({ onSelect, disabled = false }: ConnectionTypePickerProps) {
  return (
    <VStack align="stretch" gap={5}>
      {CONNECTION_TYPE_GROUPS.map((group) => {
        const options = CONNECTION_TYPES.filter((ct) => ct.group === group.id);
        if (options.length === 0) return null;

        const isManagedWarehouse = group.id === 'minusx-warehouse';
        const isComingSoon = group.id === 'coming-soon';

        return (
          <Box
            key={group.id}
            borderRadius="lg"
            border="1px solid"
            borderColor={isManagedWarehouse ? 'accent.teal/25' : isComingSoon ? 'border.default' : 'accent.primary/25'}
            overflow="hidden"
          >
            {/* Group header */}
            <HStack
              px={4}
              py={2.5}
              bg={isManagedWarehouse ? 'accent.teal/8' : isComingSoon ? 'bg.muted' : 'accent.primary/8'}
              borderBottom="1px solid"
              borderColor={isManagedWarehouse ? 'accent.teal/15' : isComingSoon ? 'border.subtle' : 'accent.primary/15'}
              justify="space-between"
            >
              <HStack gap={2} align="center">
                <Box
                  w="6px"
                  h="6px"
                  borderRadius="full"
                  bg={isManagedWarehouse ? 'accent.teal' : isComingSoon ? 'fg.subtle' : 'accent.primary'}
                  flexShrink={0}
                />
                <Text
                  fontSize="xs"
                  fontWeight="800"
                  fontFamily="mono"
                  color={isManagedWarehouse ? 'accent.teal' : isComingSoon ? 'fg.default' : 'accent.primary'}
                  textTransform="uppercase"
                  letterSpacing="0.08em"
                >
                  {group.title}
                </Text>
              </HStack>
              <Text fontSize="2xs" color="fg.muted" fontFamily="mono">
                {options.length} {options.length === 1 ? 'option' : 'options'}
              </Text>
            </HStack>

            {/* Group description */}
            <Box px={4} pt={3} pb={1}>
              <Text color="fg.muted" fontSize="xs" lineHeight="1.5">
                {group.description}
              </Text>
            </Box>

            {/* Cards */}
            <SimpleGrid columns={{ base: 1, sm: 2, md: isComingSoon ? 3 : 4 }} gap={3} p={4} pt={2}>
              {options.map((connType) => {
                const isCardDisabled = connType.comingSoon || disabled;
                return (
                  <Box
                    key={connType.type}
                    as="button"
                    onClick={() => !isCardDisabled && onSelect(connType)}
                    px={4}
                    py={3.5}
                    borderRadius="md"
                    border="1px solid"
                    borderColor={connType.comingSoon ? 'border.subtle' : 'border.default'}
                    bg="bg.surface"
                    cursor={isCardDisabled ? 'not-allowed' : 'pointer'}
                    textAlign="left"
                    transition="all 0.15s"
                    position="relative"
                    opacity={connType.comingSoon ? 0.4 : 1}
                    _hover={isCardDisabled ? {} : {
                      borderColor: 'accent.teal',
                      bg: 'accent.teal/4',
                      transform: 'translateY(-1px)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                    }}
                  >
                    {connType.comingSoon && (
                      <Box
                        position="absolute"
                        top={2}
                        right={2.5}
                        px={1.5}
                        py={0.5}
                        bg="bg.muted"
                        borderRadius="sm"
                        border="1px solid"
                        borderColor="border.subtle"
                      >
                        <Text fontSize="2xs" color="fg.muted" fontWeight="700" fontFamily="mono" letterSpacing="0.06em">
                          SOON
                        </Text>
                      </Box>
                    )}
                    <HStack gap={3} align="center" pr={connType.comingSoon ? 12 : 0}>
                      <Box w="36px" h="36px" position="relative" flexShrink={0}>
                        <Image src={connType.logo} alt={connType.name} fill style={{ objectFit: 'contain' }} />
                      </Box>
                      <VStack align="start" gap={0.5} minW={0}>
                        <Text fontWeight="700" fontSize="sm" fontFamily="mono" color="fg.default" lineHeight="1.2">
                          {connType.name}
                        </Text>
                        {connType.note && (
                          <Text fontSize="2xs" color="fg.muted" lineHeight="1.35">
                            {connType.note}
                          </Text>
                        )}
                      </VStack>
                    </HStack>
                  </Box>
                );
              })}
            </SimpleGrid>
          </Box>
        );
      })}
    </VStack>
  );
}
