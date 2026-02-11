'use client';

/**
 * ChildPathSelector - Reusable component for selecting child paths
 * Used in both SchemaTreeView (for whitelist items) and ContextEditor (for docs)
 */

import { VStack, Text, HStack, Icon } from '@chakra-ui/react';
import { LuInfo } from 'react-icons/lu';
import { Checkbox } from '@/components/ui/checkbox';

interface ChildPathSelectorProps {
  /** List of available paths to choose from */
  availablePaths: string[];

  /** Currently selected paths (undefined = all paths) */
  selectedPaths?: string[];

  /** Called when selection changes */
  onChange: (paths: string[] | undefined) => void;

  /** Optional label */
  label?: string;

  /** Optional helper text */
  helperText?: string;
}

export default function ChildPathSelector({
  availablePaths,
  selectedPaths,
  onChange,
  label = 'Apply to child paths',
  helperText = 'Leave unchecked to apply to all children'
}: ChildPathSelectorProps) {
  // If no paths available, don't render
  if (availablePaths.length === 0) {
    return null;
  }

  const handleToggle = (path: string, checked: boolean) => {
    const current = selectedPaths || [];

    if (checked) {
      // Add path
      const newPaths = [...current, path];
      onChange(newPaths);
    } else {
      // Remove path
      const newPaths = current.filter(p => p !== path);
      // If empty, set to undefined (applies to all)
      onChange(newPaths.length > 0 ? newPaths : undefined);
    }
  };

  const isAllSelected = !selectedPaths || selectedPaths.length === 0;

  return (
    <VStack align="stretch" gap={2}>
      {/* Label */}
      <HStack gap={2}>
        <Text fontSize="xs" fontWeight="600" color="fg.muted">
          {label}
        </Text>
        {helperText && (
          <HStack gap={1} color="fg.muted">
            <Icon fontSize="xs">
              <LuInfo />
            </Icon>
            <Text fontSize="xs">{helperText}</Text>
          </HStack>
        )}
      </HStack>

      {/* Path checkboxes */}
      <VStack align="stretch" gap={1} pl={2}>
        {availablePaths.map(path => {
          const isChecked = selectedPaths?.includes(path) || false;

          return (
            <Checkbox
              key={path}
              size="sm"
              checked={isChecked}
              onCheckedChange={(e) => handleToggle(path, e.checked)}
            >
              <Text fontSize="xs" fontFamily="mono" color={isAllSelected ? 'fg.muted' : 'fg.default'}>
                {path}
              </Text>
            </Checkbox>
          );
        })}
      </VStack>

      {/* All selected hint */}
      {isAllSelected && (
        <Text fontSize="xs" color="fg.muted" fontStyle="italic" pl={2}>
          Applies to all children
        </Text>
      )}
    </VStack>
  );
}
