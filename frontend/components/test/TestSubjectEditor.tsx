'use client';

import {
  VStack, HStack, Text, Input, Textarea, NativeSelect,
  Box, Combobox, Portal, createListCollection
} from '@chakra-ui/react';
import { useState, useMemo, useEffect } from 'react';
import type { TestSubject } from '@/lib/types';
import { useFilesByCriteria } from '@/lib/hooks/file-state-hooks';
import { useConnections } from '@/lib/hooks/useConnections';
import DatabaseSelector from '@/components/DatabaseSelector';

interface TestSubjectEditorProps {
  subject: TestSubject;
  testType: 'llm' | 'query';
  onChange: (subject: TestSubject) => void;
  disabled?: boolean;
  /** Pre-select this question ID when a new query subject is created */
  defaultQuestionId?: number;
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

/**
 * Fetch inferred column names for a question via /api/infer-columns.
 * Returns [] while loading or on error.
 */
function useQuestionColumns(questionId: number | undefined): string[] {
  const [columns, setColumns] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const fetcher = questionId && questionId > 0
      ? fetch('/api/infer-columns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionId }),
        }).then(r => r.ok ? r.json() : { columns: [] })
      : Promise.resolve({ columns: [] });

    fetcher
      .then(data => { if (!cancelled) setColumns((data?.columns ?? []).map((c: { name: string }) => c.name)); })
      .catch(() => { if (!cancelled) setColumns([]); });
    return () => { cancelled = true; };
  }, [questionId]);

  return columns;
}

export default function TestSubjectEditor({ subject, testType, onChange, disabled, defaultQuestionId }: TestSubjectEditorProps) {
  // Query type derived state — always computed so hook order is stable
  const query = subject.type === 'query'
    ? subject
    : { type: 'query' as const, question_id: defaultQuestionId ?? 0, column: undefined, row: undefined };
  const inferredColumns = useQuestionColumns(query.question_id || undefined);

  // Auto-select first available connection for LLM tests when none is set
  const { connections } = useConnections({ skip: true });
  useEffect(() => {
    if (testType !== 'llm') return;
    if (subject.type === 'llm' && subject.connection_id) return;
    const firstConnection = Object.keys(connections)[0];
    if (!firstConnection) return;
    const llm = subject.type === 'llm' ? subject : { type: 'llm' as const, prompt: '', context: { type: 'explore' as const } };
    onChange({ ...llm, connection_id: firstConnection });
  }, [testType, connections]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <Box>
          <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Connection</Text>
          <DatabaseSelector
            value={llm.connection_id ?? ''}
            onChange={connection_id => onChange({ ...llm, connection_id: connection_id || undefined })}
            size="sm"
          />
        </Box>
      </VStack>
    );
  }

  return (
    <VStack align="stretch" gap={2}>
      <Box>
        <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Question</Text>
        <QuestionPicker
          selectedId={query.question_id || null}
          onSelect={id => onChange({ ...query, question_id: id, column: undefined })}
          disabled={disabled}
        />
      </Box>
      <HStack gap={2}>
        <Box flex={1}>
          <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Column</Text>
          {inferredColumns.length > 0 ? (
            <NativeSelect.Root size="sm" disabled={disabled}>
              <NativeSelect.Field
                value={query.column ?? ''}
                onChange={e => onChange({ ...query, column: e.target.value || undefined })}
                bg="bg.surface"
                fontSize="xs"
                fontFamily="mono"
              >
                <option value="">— first column —</option>
                {inferredColumns.map(col => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          ) : (
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
          )}
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
