'use client';

/**
 * ChildPathSelector - Reusable collapsible component for selecting child paths
 * Used in both SchemaTreeView (for whitelist items) and ContextEditor (for docs)
 *
 * Semantics:
 * - undefined = applies to ALL children (default)
 * - [] = applies to NO children (only this folder)
 * - [...paths] = applies to specific children only
 */

import { useState } from 'react';
import { Box, VStack, Text, HStack, Icon, Collapsible } from '@chakra-ui/react';
import { LuChevronRight, LuChevronDown } from 'react-icons/lu';
import { Checkbox } from '@/components/ui/checkbox';

interface ChildPathSelectorProps {
  /** List of available paths to choose from */
  availablePaths: string[];

  /** Currently selected paths (undefined = all paths, [] = none) */
  selectedPaths?: string[];

  /** Called when selection changes */
  onChange: (paths: string[] | undefined) => void;
}

function getSummaryLabel(selectedPaths: string[] | undefined, totalPaths: number): string {
  if (selectedPaths === undefined) return 'All child paths';
  if (selectedPaths.length === 0) return 'Only this folder, no children';
  if (selectedPaths.length === 1) return selectedPaths[0];
  return `${selectedPaths.length}/${totalPaths} child paths`;
}

export default function ChildPathSelector({
  availablePaths,
  selectedPaths,
  onChange,
}: ChildPathSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);

  // If no paths available, don't render
  if (availablePaths.length === 0) {
    return null;
  }

  // undefined = all, array (even empty) = specific selection
  const isAll = selectedPaths === undefined;
  const summaryLabel = getSummaryLabel(selectedPaths, availablePaths.length);

  const handleAllToggle = (checked: boolean) => {
    if (checked) {
      onChange(undefined); // all children
    } else {
      onChange([]); // no children
    }
  };

  const handlePathToggle = (path: string, checked: boolean) => {
    const current = selectedPaths || [];
    if (checked) {
      onChange([...current, path]);
    } else {
      onChange(current.filter(p => p !== path));
    }
  };

  return (
    <Collapsible.Root open={isOpen} onOpenChange={(e) => setIsOpen(e.open)}>
      <Collapsible.Trigger asChild>
        <HStack gap={1.5} cursor="pointer" py={0.5}>
          <Icon
            as={isOpen ? LuChevronDown : LuChevronRight}
            boxSize={3}
            color="fg.muted"
          />
          <Text fontSize="xs" color="fg.muted">Apply to:</Text>
          <Box
            px={1.5}
            py={0.5}
            bg={'accent.cyan/15'}
            borderRadius="sm"
            border="1px solid"
            borderColor={'accent.cyan/30'}
          >
            <Text
              fontSize="2xs"
              fontWeight="700"
              color={'accent.cyan'}
              fontFamily="mono"
            >
              {summaryLabel}
            </Text>
          </Box>
        </HStack>
      </Collapsible.Trigger>

      <Collapsible.Content>
        <VStack align="stretch" gap={1} pl={4} pt={2}>
          {/* All child paths (default) checkbox */}
          <Checkbox
            size="sm"
            checked={isAll}
            onCheckedChange={(e) => handleAllToggle(e.checked)}
          >
            <Text fontSize="xs">All child paths (default)</Text>
          </Checkbox>

          {availablePaths.map(path => {
            const isChecked = selectedPaths?.includes(path) || false;

            return (
              <Checkbox
                key={path}
                size="sm"
                checked={isChecked}
                disabled={isAll}
                onCheckedChange={(e) => handlePathToggle(path, e.checked)}
              >
                <Text fontSize="xs" fontFamily="mono" color={isAll ? 'fg.muted' : 'fg.default'}>
                  {path}
                </Text>
              </Checkbox>
            );
          })}
        </VStack>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
