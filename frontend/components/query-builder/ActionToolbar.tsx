/**
 * ActionToolbar
 * Icon buttons for Filter, Summarize, Join, Sort, Row limit, Custom column
 */

'use client';

import { Box, HStack, VStack, Text, Input, Popover, Portal } from '@chakra-ui/react';
import {
  LuFilter,
  LuSigma,
  LuGitMerge,
  LuArrowUpDown,
  LuListOrdered,
} from 'react-icons/lu';
import { useState } from 'react';

interface ActionToolbarProps {
  onFilterClick: () => void;
  onSummarizeClick: () => void;
  onHavingClick?: () => void;
  onJoinClick: () => void;
  onSortClick: () => void;
  onLimitChange: (limit: number | undefined) => void;
  currentLimit?: number;
  hasFilter?: boolean;
  hasSummarize?: boolean;
  hasHaving?: boolean;
  hasJoin?: boolean;
  hasSort?: boolean;
}

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  isActive?: boolean;
}

function ActionButton({ icon, label, onClick, isActive }: ActionButtonProps) {
  return (
    <VStack
      as="button"
      gap={1}
      px={3}
      py={2}
      flex={1}
      borderRadius="lg"
      border="1px solid"
      borderColor={isActive ? 'rgba(45, 212, 191, 0.4)' : 'rgba(255, 255, 255, 0.08)'}
      bg={isActive ? 'rgba(45, 212, 191, 0.1)' : 'transparent'}
      cursor="pointer"
      transition="all 0.15s ease"
      _hover={{
        bg: 'rgba(255, 255, 255, 0.05)',
        borderColor: 'rgba(255, 255, 255, 0.15)',
        transform: 'translateY(-1px)',
      }}
      onClick={onClick}
    >
      <Box color={isActive ? '#2dd4bf' : 'fg.muted'} fontSize="lg">
        {icon}
      </Box>
      <Text fontSize="xs" color={isActive ? '#2dd4bf' : 'fg.muted'} fontWeight="500">
        {label}
      </Text>
    </VStack>
  );
}

export function ActionToolbar({
  onFilterClick,
  onSummarizeClick,
  onHavingClick,
  onJoinClick,
  onSortClick,
  onLimitChange,
  currentLimit,
  hasFilter,
  hasSummarize,
  hasHaving,
  hasJoin,
  hasSort,
}: ActionToolbarProps) {
  const [limitOpen, setLimitOpen] = useState(false);
  const [limitValue, setLimitValue] = useState(currentLimit?.toString() || '');

  const handleLimitSubmit = () => {
    const num = parseInt(limitValue, 10);
    onLimitChange(isNaN(num) || num <= 0 ? undefined : num);
    setLimitOpen(false);
  };

  return (
    <HStack gap={2} flexWrap="wrap" py={2} width="100%">
      <ActionButton
        icon={<LuFilter size={18} />}
        label="Filter"
        onClick={onFilterClick}
        isActive={hasFilter}
      />

      <ActionButton
        icon={<LuSigma size={18} />}
        label="Summarize"
        onClick={onSummarizeClick}
        isActive={hasSummarize}
      />

      {/* HAVING button - only show if onHavingClick provided */}
      {onHavingClick && (
        <ActionButton
          icon={<LuFilter size={18} />}
          label="Having"
          onClick={onHavingClick}
          isActive={hasHaving}
        />
      )}

      <ActionButton
        icon={<LuGitMerge size={18} />}
        label="Join data"
        onClick={onJoinClick}
        isActive={hasJoin}
      />

      <ActionButton
        icon={<LuArrowUpDown size={18} />}
        label="Sort"
        onClick={onSortClick}
        isActive={hasSort}
      />

      {/* Row limit with popover */}
      <Popover.Root open={limitOpen} onOpenChange={(details) => setLimitOpen(details.open)}>
        <Popover.Trigger asChild>
          <VStack
            as="button"
            gap={1}
            px={3}
            py={2}
            flex={1}
            borderRadius="lg"
            border="1px solid"
            borderColor={currentLimit ? 'rgba(45, 212, 191, 0.4)' : 'rgba(255, 255, 255, 0.08)'}
            bg={currentLimit ? 'rgba(45, 212, 191, 0.1)' : 'transparent'}
            cursor="pointer"
            transition="all 0.15s ease"
            _hover={{
              bg: 'rgba(255, 255, 255, 0.05)',
              borderColor: 'rgba(255, 255, 255, 0.15)',
              transform: 'translateY(-1px)',
            }}
          >
            <Box color={currentLimit ? '#2dd4bf' : 'fg.muted'} fontSize="lg">
              <LuListOrdered size={18} />
            </Box>
            <Text fontSize="xs" color={currentLimit ? '#2dd4bf' : 'fg.muted'} fontWeight="500">
              {currentLimit ? `${currentLimit} rows` : 'Row limit'}
            </Text>
          </VStack>
        </Popover.Trigger>
        <Portal>
          <Popover.Positioner>
            <Popover.Content width="180px" bg="gray.900" borderColor="gray.700" border="1px solid" p={0} overflow="hidden" borderRadius="lg">
              <Popover.Body p={3}>
                <VStack gap={2} align="stretch">
                  <Text fontSize="xs" fontWeight="600" color="fg.muted" textTransform="uppercase">
                    Row limit
                  </Text>
                  <Input
                    type="number"
                    size="sm"
                    placeholder="No limit"
                    value={limitValue}
                    onChange={(e) => setLimitValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleLimitSubmit();
                    }}
                    min={1}
                  />
                  <HStack gap={1} flexWrap="wrap">
                    {[100, 500, 1000, 2000].map((num) => (
                      <Box
                        key={num}
                        as="button"
                        px={2}
                        py={1}
                        borderRadius="md"
                        bg="rgba(255, 255, 255, 0.05)"
                        fontSize="xs"
                        color="fg.muted"
                        _hover={{ bg: 'rgba(255, 255, 255, 0.1)' }}
                        onClick={() => {
                          setLimitValue(num.toString());
                          onLimitChange(num);
                          setLimitOpen(false);
                        }}
                      >
                        {num}
                      </Box>
                    ))}
                  </HStack>
                </VStack>
              </Popover.Body>
            </Popover.Content>
          </Popover.Positioner>
        </Portal>
      </Popover.Root>

    </HStack>
  );
}
