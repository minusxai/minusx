'use client';

import { Select as ChakraSelect } from '@chakra-ui/react';
import { forwardRef } from 'react';

export const SelectRoot = ChakraSelect.Root;
export const SelectTrigger = forwardRef<HTMLButtonElement, React.ComponentProps<typeof ChakraSelect.Trigger>>(
  (props, ref) => <ChakraSelect.Trigger ref={ref} {...props} />
);
SelectTrigger.displayName = 'SelectTrigger';

export const SelectPositioner = ChakraSelect.Positioner;
export const SelectContent = ChakraSelect.Content;
export const SelectItem = ChakraSelect.Item;
export const SelectValueText = ChakraSelect.ValueText;
export const SelectLabel = ChakraSelect.Label;
export const SelectItemText = ChakraSelect.ItemText;
export const SelectItemIndicator = ChakraSelect.ItemIndicator;
