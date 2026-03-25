'use client';

import {
  VStack, HStack, Text, Input, NativeSelect,
  Box, Combobox, Portal, createListCollection
} from '@chakra-ui/react';
import { useState, useMemo } from 'react';
import type { TestAnswerType, TestValue } from '@/lib/types';
import { useFilesByCriteria } from '@/lib/hooks/file-state-hooks';

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

interface TestValueEditorProps {
  value: TestValue;
  answerType: TestAnswerType;
  onChange: (value: TestValue) => void;
  disabled?: boolean;
  /** When true, show the "Cannot answer" value option */
  allowCannotAnswer?: boolean;
}

export default function TestValueEditor({ value, answerType, onChange, disabled, allowCannotAnswer }: TestValueEditorProps) {
  const valueSourceOptions = [
    { value: 'constant', label: 'Constant' },
    { value: 'query', label: 'From question' },
    ...(allowCannotAnswer ? [{ value: 'cannot_answer', label: 'Cannot answer' }] : []),
  ];

  // binary only supports constant (yes/no), and cannot_answer has no sub-fields
  const showSourcePicker = answerType !== 'binary' || allowCannotAnswer;

  return (
    <VStack align="stretch" gap={2}>
      {showSourcePicker && (
        <Box>
          <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Value source</Text>
          <NativeSelect.Root size="sm" disabled={disabled}>
            <NativeSelect.Field
              value={value.type}
              onChange={e => {
                if (e.target.value === 'constant') {
                  onChange({ type: 'constant', value: answerType === 'number' ? 0 : answerType === 'binary' ? true : '' });
                } else if (e.target.value === 'cannot_answer') {
                  onChange({ type: 'cannot_answer' });
                } else {
                  onChange({ type: 'query', question_id: 0 });
                }
              }}
            >
              {valueSourceOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Box>
      )}

      {value.type === 'constant' && (
        <Box>
          <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Expected value</Text>
          {answerType === 'binary' ? (
            <NativeSelect.Root size="sm" disabled={disabled}>
              <NativeSelect.Field
                value={String(value.value)}
                onChange={e => onChange({ type: 'constant', value: e.target.value === 'true' })}
              >
                <option value="true">True (yes)</option>
                <option value="false">False (no)</option>
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          ) : answerType === 'number' ? (
            <Input
              type="number"
              value={String(value.value)}
              onChange={e => onChange({ type: 'constant', value: parseFloat(e.target.value) || 0 })}
              size="sm"
              bg="bg.surface"
              fontSize="xs"
              fontFamily="mono"
              disabled={disabled}
            />
          ) : (
            <Input
              value={String(value.value)}
              onChange={e => onChange({ type: 'constant', value: e.target.value })}
              placeholder="expected value"
              size="sm"
              bg="bg.surface"
              fontSize="xs"
              maxLength={100}
              disabled={disabled}
            />
          )}
        </Box>
      )}

      {value.type === 'query' && (
        <>
          <Box>
            <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Question</Text>
            <QuestionPicker
              selectedId={value.question_id || null}
              onSelect={id => onChange({ ...value, question_id: id })}
              disabled={disabled}
            />
          </Box>
          <HStack gap={2}>
            <Box flex={1}>
              <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Column</Text>
              <Input
                value={value.column ?? ''}
                onChange={e => onChange({ ...value, column: e.target.value || undefined })}
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
                value={value.row ?? ''}
                onChange={e => {
                  const v = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                  onChange({ ...value, row: v });
                }}
                placeholder="0"
                size="sm"
                bg="bg.surface"
                fontSize="xs"
                disabled={disabled}
              />
            </Box>
          </HStack>
        </>
      )}
    </VStack>
  );
}
