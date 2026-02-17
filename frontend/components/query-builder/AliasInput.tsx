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
      bg="bg.subtle"
      borderColor="border.default"
      _hover={{ borderColor: 'border.emphasized' }}
      _focus={{
        borderColor: 'accent.primary',
        boxShadow: '0 0 0 1px var(--chakra-colors-accent-primary)'
      }}
    />
  );
}
