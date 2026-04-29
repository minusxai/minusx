'use client';

import {
  VStack, HStack, Text, Input, Textarea,
  Box, Combobox, Portal, createListCollection
} from '@chakra-ui/react';
import { useState, useMemo } from 'react';
import type { TestAnswerType, TestValue } from '@/lib/types';
import { useFilesByCriteria } from '@/lib/hooks/file-state-hooks';
import DatabaseSelector from '@/components/DatabaseSelector';
import SimpleSelect from './SimpleSelect';

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
      items: filtered.filter(q => q.id != null).map(q => ({ value: String(q.id), label: q.name }))
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
  // Derive the selector value: 'constant' | 'query_question' | 'query_inline' | 'cannot_answer'
  const selectorValue =
    value.type === 'constant' ? 'constant'
    : value.type === 'cannot_answer' ? 'cannot_answer'
    : value.source === 'inline' ? 'query_inline'
    : 'query_question';

  const valueSourceOptions = [
    { value: 'constant', label: 'Constant' },
    { value: 'query_question', label: 'Saved question' },
    { value: 'query_inline', label: 'Inline SQL' },
    ...(allowCannotAnswer ? [{ value: 'cannot_answer', label: 'Cannot answer' }] : []),
  ];

  // binary only supports constant (yes/no), and cannot_answer has no sub-fields
  const showSourcePicker = answerType !== 'binary' || allowCannotAnswer;

  function handleSourceChange(newSource: string) {
    if (newSource === 'constant') {
      onChange({ type: 'constant', value: answerType === 'number' ? 0 : answerType === 'binary' ? true : '' });
    } else if (newSource === 'cannot_answer') {
      onChange({ type: 'cannot_answer' });
    } else if (newSource === 'query_inline') {
      onChange({ type: 'query', source: 'inline', sql: '', connection_name: '', column: undefined, row: undefined });
    } else {
      onChange({ type: 'query', source: 'question', question_id: 0 });
    }
  }

  // For question-type query value, get the question_id safely
  const queryQuestion = value.type === 'query' && value.source !== 'inline' ? value : null;
  const queryInline = value.type === 'query' && value.source === 'inline' ? value : null;

  const binaryOptions = [
    { value: 'true', label: 'True (yes)' },
    { value: 'false', label: 'False (no)' },
  ];

  return (
    <VStack align="stretch" gap={2}>
      {/* Constant: value source + expected value on one row */}
      {value.type === 'constant' && (
        <HStack gap={2} align="flex-end">
          {showSourcePicker && (
            <Box w="120px" flexShrink={0}>
              <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Value source</Text>
              <SimpleSelect
                value={selectorValue}
                onChange={handleSourceChange}
                options={valueSourceOptions}
                disabled={disabled}
              />
            </Box>
          )}
          <Box flex={1}>
            <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Expected value</Text>
            {answerType === 'binary' ? (
              <SimpleSelect
                value={String(value.value)}
                onChange={v => onChange({ type: 'constant', value: v === 'true' })}
                options={binaryOptions}
                disabled={disabled}
              />
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
        </HStack>
      )}

      {/* cannot_answer: just the source picker */}
      {value.type === 'cannot_answer' && showSourcePicker && (
        <Box>
          <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Value source</Text>
          <SimpleSelect
            value={selectorValue}
            onChange={handleSourceChange}
            options={valueSourceOptions}
            disabled={disabled}
          />
        </Box>
      )}

      {/* Query question: source picker + question on one row, column+row on next */}
      {queryQuestion && (
        <>
          <HStack gap={2} align="flex-end">
            {showSourcePicker && (
              <Box w="120px" flexShrink={0}>
                <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Value source</Text>
                <SimpleSelect
                  value={selectorValue}
                  onChange={handleSourceChange}
                  options={valueSourceOptions}
                  disabled={disabled}
                />
              </Box>
            )}
            <Box flex={1}>
              <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Question</Text>
              <QuestionPicker
                selectedId={queryQuestion.question_id || null}
                onSelect={id => onChange({ ...queryQuestion, question_id: id })}
                disabled={disabled}
              />
            </Box>
          </HStack>
          <HStack gap={2}>
            <Box flex={1}>
              <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Column</Text>
              <Input
                value={queryQuestion.column ?? ''}
                onChange={e => onChange({ ...queryQuestion, column: e.target.value || undefined })}
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
                value={queryQuestion.row ?? ''}
                onChange={e => {
                  const v = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                  onChange({ ...queryQuestion, row: v });
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

      {/* Query inline: source picker then inline editor */}
      {queryInline && (
        <>
          {showSourcePicker && (
            <Box>
              <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Value source</Text>
              <SimpleSelect
                value={selectorValue}
                onChange={handleSourceChange}
                options={valueSourceOptions}
                disabled={disabled}
              />
            </Box>
          )}
          <HStack gap={2} align="flex-end">
            <Box flex={1}>
              <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Connection</Text>
              <DatabaseSelector
                value={queryInline.connection_name}
                onChange={({ connection_name: db }) => onChange({ ...queryInline, connection_name: db })}
                size="sm"
              />
            </Box>
          </HStack>
          <Box>
            <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">SQL</Text>
            <Textarea
              value={queryInline.sql}
              onChange={e => onChange({ ...queryInline, sql: e.target.value })}
              placeholder="SELECT ..."
              size="sm"
              rows={3}
              bg="bg.surface"
              fontSize="xs"
              fontFamily="mono"
              disabled={disabled}
            />
          </Box>
          <HStack gap={2}>
            <Box flex={1}>
              <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Column</Text>
              <Input
                value={queryInline.column ?? ''}
                onChange={e => onChange({ ...queryInline, column: e.target.value || undefined })}
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
                value={queryInline.row ?? ''}
                onChange={e => {
                  const v = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                  onChange({ ...queryInline, row: v });
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
