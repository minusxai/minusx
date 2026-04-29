'use client';

import { useMemo, useState } from 'react';
import { createListCollection, Combobox } from '@chakra-ui/react';

interface FileSearchSelectProps {
  files: { id: number; name: string }[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  placeholder?: string;
}

/** Searchable file selector — renders a combobox for picking a file by name. */
export default function FileSearchSelect({ files, selectedId, onSelect, placeholder }: FileSearchSelectProps) {
  const [inputValue, setInputValue] = useState('');

  const filteredCollection = useMemo(() => {
    const lower = inputValue.toLowerCase();
    const filtered = lower
      ? files.filter(f => f.name.toLowerCase().includes(lower))
      : files;
    return createListCollection({
      items: filtered.filter(f => f.id != null).map(f => ({ value: String(f.id), label: f.name }))
    });
  }, [files, inputValue]);

  return (
    <Combobox.Root
      collection={filteredCollection}
      value={selectedId ? [selectedId.toString()] : []}
      onValueChange={(e) => {
        if (e.value[0]) onSelect(parseInt(e.value[0], 10));
      }}
      onInputValueChange={(details) => setInputValue(details.inputValue)}
      inputBehavior="autohighlight"
      openOnClick
      positioning={{ gutter: 2 }}
      size="sm"
    >
      <Combobox.Control>
        <Combobox.Input
          placeholder={placeholder || 'Search...'}
          bg="bg.surface"
          fontSize="xs"
          onClick={e => e.stopPropagation()}
        />
      </Combobox.Control>
      <Combobox.Positioner>
        <Combobox.Content>
          <Combobox.Empty>No results found</Combobox.Empty>
          {filteredCollection.items.map((item) => (
            <Combobox.Item key={item.value} item={item}>
              <Combobox.ItemText>{item.label}</Combobox.ItemText>
              <Combobox.ItemIndicator />
            </Combobox.Item>
          ))}
        </Combobox.Content>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}
