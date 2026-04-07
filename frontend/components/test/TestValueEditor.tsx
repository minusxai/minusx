'use client';

import {
  VStack, HStack, Text, Input, Textarea, NativeSelect,
  Box, Combobox, Portal, createListCollection
} from '@chakra-ui/react';
import { useState, useMemo } from 'react';
import type { TestAnswerType, TestValue } from '@/lib/types';
import { useFilesByCriteria } from '@/lib/hooks/file-state-hooks';
import DatabaseSelector from '@/components/DatabaseSelector';

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
      onChange({ type: 'query', source: 'inline', sql: '', database_name: '', column: undefined, row: undefined });
    } else {
      onChange({ type: 'query', source: 'question', question_id: 0 });
    }
  }

  // For question-type query value, get the question_id safely
  const queryQuestion = value.type === 'query' && value.source !== 'inline' ? value : null;
  const queryInline = value.type === 'query' && value.source === 'inline' ? value : null;

  return (
    <VStack align="stretch" gap={2}>
      {showSourcePicker && (
        <Box>
          <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Value source</Text>
          <NativeSelect.Root size="sm" disabled={disabled}>
            <NativeSelect.Field
              value={selectorValue}
              onChange={e => handleSourceChange(e.target.value)}
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

      {queryQuestion && (
        <>
          <Box>
            <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Question</Text>
            <QuestionPicker
              selectedId={queryQuestion.question_id || null}
              onSelect={id => onChange({ ...queryQuestion, question_id: id })}
              disabled={disabled}
            />
          </Box>
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

      {queryInline && (
        <>
          <Box>
            <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Connection</Text>
            <DatabaseSelector
              value={queryInline.database_name}
              onChange={db => onChange({ ...queryInline, database_name: db })}
              size="sm"
            />
          </Box>
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
