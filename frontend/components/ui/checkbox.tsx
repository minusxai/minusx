'use client';

import { Checkbox as ChakraCheckbox } from '@chakra-ui/react';

export interface CheckboxProps {
  checked?: boolean;
  onCheckedChange?: (checked: { checked: boolean }) => void;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  children?: React.ReactNode;
}

export function Checkbox({ checked, onCheckedChange, size = 'md', disabled, children, ...props }: CheckboxProps) {
  return (
    <ChakraCheckbox.Root
      checked={checked}
      onCheckedChange={(details) => {
        onCheckedChange?.({ checked: details.checked === true });
      }}
      size={size}
      disabled={disabled}
      {...props}
    >
      <ChakraCheckbox.HiddenInput />
      <ChakraCheckbox.Control
        _checked={{ bg: 'accent.teal', borderColor: 'accent.teal' }}
      />
      {children && <ChakraCheckbox.Label>{children}</ChakraCheckbox.Label>}
    </ChakraCheckbox.Root>
  );
}
