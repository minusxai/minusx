/**
 * AliasInput
 * Reusable component for editing column/table aliases
 */

'use client';

import { Input } from '@chakra-ui/react';

interface AliasInputProps {
  value?: string;
  onChange: (alias: string | undefined) => void;
  placeholder?: string;
  width?: string;
}

export function AliasInput({
  value,
  onChange,
  placeholder = 'Alias (optional)',
  width = '120px'
}: AliasInputProps) {
  return (
    <Input
      size="sm"
      placeholder={placeholder}
      value={value || ''}
      onChange={(e) => {
        const trimmed = e.target.value.trim();
        onChange(trimmed || undefined);
      }}
      width={width}
      fontSize="sm"
      bg="rgba(255, 255, 255, 0.02)"
      borderColor="rgba(255, 255, 255, 0.1)"
      _hover={{ borderColor: 'rgba(255, 255, 255, 0.2)' }}
      _focus={{
        borderColor: 'blue.400',
        boxShadow: '0 0 0 1px var(--chakra-colors-blue-400)'
      }}
    />
  );
}
