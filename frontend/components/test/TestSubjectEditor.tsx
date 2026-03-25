'use client';

import {
  VStack, HStack, Text, Input, Textarea, NativeSelect,
  Box, Combobox, Portal, createListCollection
} from '@chakra-ui/react';
import { useState, useMemo } from 'react';
import type { TestSubject } from '@/lib/types';
import { useFilesByCriteria } from '@/lib/hooks/file-state-hooks';

interface TestSubjectEditorProps {
  subject: TestSubject;
  testType: 'llm' | 'query';
  onChange: (subject: TestSubject) => void;
  disabled?: boolean;
}

function QuestionPicker({
  selectedId,
  onSelect,
  disabled,
}: {
  selectedId: number | null;
  onSelect: (id: number) => void;
  disabled?: boolean;
}) {
  const [inputValue, setInputValue] = useState('');
  const { files: questionFiles } = useFilesByCriteria({
    criteria: { type: 'question' },
    skip: false,
  });

  const questions = questionFiles.map(f => ({ id: f.id, name: f.name }));

  const filteredCollection = useMemo(() => {
    const lower = inputValue.toLowerCase();
    const filtered = lower
      ? questions.filter(q => q.name.toLowerCase().includes(lower))
      : questions;
    return createListCollection({
      items: filtered.map(q => ({ value: q.id.toString(), label: q.name }))
    });
  }, [questions, inputValue]);

  return (
    <Combobox.Root
      collection={filteredCollection}
      value={selectedId ? [selectedId.toString()] : []}
      onValueChange={(e) => { if (e.value[0]) onSelect(parseInt(e.value[0], 10)); }}
      onInputValueChange={(d) => setInputValue(d.inputValue)}
      inputBehavior="autohighlight"
      openOnClick
      positioning={{ gutter: 2 }}
      size="sm"
      disabled={disabled}
    >
      <Combobox.Control>
        <Combobox.Input placeholder="Search questions…" bg="bg.surface" fontSize="xs" />
      </Combobox.Control>
      <Portal>
        <Combobox.Positioner>
          <Combobox.Content>
            <Combobox.Empty>No questions found</Combobox.Empty>
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

export default function TestSubjectEditor({ subject, testType, onChange, disabled }: TestSubjectEditorProps) {
  if (testType === 'llm') {
    const llm = subject.type === 'llm' ? subject : { type: 'llm' as const, prompt: '', context: { type: 'explore' as const } };

    const contextOptions = [
      { value: 'explore', label: 'Explore workspace' },
    ];

    return (
      <VStack align="stretch" gap={2}>
        <Box>
          <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Prompt</Text>
          <Textarea
            value={llm.prompt}
            onChange={e => onChange({ ...llm, prompt: e.target.value })}
            placeholder="What is the total revenue this month?"
            size="sm"
            rows={2}
            bg="bg.surface"
            fontSize="xs"
            disabled={disabled}
          />
        </Box>
        <Box>
          <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Context</Text>
          <NativeSelect.Root size="sm" disabled={disabled}>
            <NativeSelect.Field
              value={llm.context.type}
              onChange={e => onChange({ ...llm, context: { type: e.target.value as 'explore' } })}
            >
              {contextOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Box>
      </VStack>
    );
  }

  // Query type
  const query = subject.type === 'query'
    ? subject
    : { type: 'query' as const, question_id: 0, column: undefined, row: undefined };

  return (
    <VStack align="stretch" gap={2}>
      <Box>
        <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Question</Text>
        <QuestionPicker
          selectedId={query.question_id || null}
          onSelect={id => onChange({ ...query, question_id: id })}
          disabled={disabled}
        />
      </Box>
      <HStack gap={2}>
        <Box flex={1}>
          <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Column</Text>
          <Input
            value={query.column ?? ''}
            onChange={e => onChange({ ...query, column: e.target.value || undefined })}
            placeholder="(first column)"
            size="sm"
            bg="bg.surface"
            fontSize="xs"
            fontFamily="mono"
            disabled={disabled}
          />
        </Box>
        <Box w="80px">
          <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Row</Text>
          <Input
            type="number"
            value={query.row ?? ''}
            onChange={e => {
              const v = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
              onChange({ ...query, row: v });
            }}
            placeholder="0"
            size="sm"
            bg="bg.surface"
            fontSize="xs"
            disabled={disabled}
          />
        </Box>
      </HStack>
    </VStack>
  );
}
