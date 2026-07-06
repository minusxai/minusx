'use client';

import { Combobox, Portal, createListCollection } from '@chakra-ui/react';
import { useState, useMemo } from 'react';

interface SimpleSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export default function SimpleSelect({ value, onChange, options, placeholder, disabled, size = 'sm' }: SimpleSelectProps) {
  const [inputValue, setInputValue] = useState('');

  const filteredCollection = useMemo(() => {
    const lower = inputValue.toLowerCase();
    const filtered = lower
      ? options.filter(o => o.label.toLowerCase().includes(lower))
      : options;
    return createListCollection({ items: filtered });
  }, [options, inputValue]);

  return (
    <Combobox.Root
      collection={filteredCollection}
      value={[value]}
      onValueChange={(e) => { if (e.value[0] !== undefined) onChange(e.value[0]); }}
      onInputValueChange={(d) => setInputValue(d.inputValue)}
      inputBehavior="autohighlight"
      openOnClick
      positioning={{ gutter: 2 }}
      size={size}
      disabled={disabled}
    >
      <Combobox.Control>
        <Combobox.Input placeholder={placeholder} bg="bg.surface" fontSize="xs" />
      </Combobox.Control>
      <Portal>
        <Combobox.Positioner>
          <Combobox.Content>
            <Combobox.Empty>No matches</Combobox.Empty>
            {filteredCollection.items.map(item => (
              <Combobox.Item key={item.value} item={item}>
                <Combobox.ItemText>{item.label}</Combobox.ItemText>
                <Combobox.ItemIndicator />
              </Combobox.Item>
            ))}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
}
