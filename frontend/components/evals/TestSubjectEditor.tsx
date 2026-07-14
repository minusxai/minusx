'use client';

import {
  VStack, HStack, Text, Textarea,
  Box, Combobox, Portal, createListCollection
} from '@chakra-ui/react';
import { useState, useMemo, useEffect } from 'react';
import type { TestSubject } from '@/lib/types';
import { connectionTypeToDialect } from '@/lib/types';
import { useFilesByCriteria } from '@/lib/hooks/file-state-hooks';
import { useConnections } from '@/lib/hooks/useConnections';
import DatabaseSelector from '@/components/selectors/DatabaseSelector';
import SqlEditor from '@/components/query-builder/SqlEditor';
import { QueryValueSelector } from '@/components/query-value-selector';
import SimpleSelect from './SimpleSelect';

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

/** Inline SQL subject: DatabaseSelector + GUI/SQL toggle + editor + Column + Row */
function InlineSubjectEditor({
  subject,
  onChange,
  disabled,
}: {
  subject: Extract<TestSubject, { source: 'inline' }>;
  onChange: (subject: TestSubject) => void;
  disabled?: boolean;
}) {
  const { connections } = useConnections({ skip: true });
  const dialect = connectionTypeToDialect(connections[subject.connection_name]?.metadata?.type ?? '');

  // Auto-select first connection if none set
  useEffect(() => {
    if (subject.connection_name) return;
    const first = Object.keys(connections)[0];
    if (!first) return;
    onChange({ ...subject, connection_name: first });
  }, [connections]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <VStack align="stretch" gap={2}>
      <Box>
        <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Connection</Text>
        <DatabaseSelector
          value={subject.connection_name}
          onChange={({ connection_name: db }) => onChange({ ...subject, connection_name: db })}
          size="sm"
        />
      </Box>
      <Box>
        <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Query</Text>
        <Box border="1px solid" borderColor="border.muted" borderRadius="md" overflow="hidden">
          <SqlEditor
            value={subject.sql}
            onChange={sql => onChange({ ...subject, sql })}
          />
        </Box>
      </Box>
      <QueryValueSelector
        source={subject.sql.trim() && subject.connection_name
          ? { kind: 'inline', sql: subject.sql, connectionName: subject.connection_name }
          : null}
        column={subject.column}
        onColumnChange={column => onChange({ ...subject, column })}
        row={subject.row}
        onRowChange={row => onChange({ ...subject, row })}
        disabled={disabled}
      />
    </VStack>
  );
}

export default function TestSubjectEditor({ subject, testType, onChange, disabled, defaultQuestionId }: TestSubjectEditorProps) {
  // Query type derived state — always computed so hook order is stable
  const query = subject.type === 'query' && subject.source !== 'inline'
    ? subject
    : { type: 'query' as const, source: 'question' as const, question_id: defaultQuestionId ?? 0, column: undefined, row: undefined };

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
          <SimpleSelect
            value={llm.context.type}
            onChange={v => onChange({ ...llm, context: { type: v as 'explore' } })}
            options={contextOptions}
            disabled={disabled}
          />
        </Box>
        <Box>
          <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Connection</Text>
          <DatabaseSelector
            value={llm.connection_id ?? ''}
            onChange={({ connection_name: connection_id }) => onChange({ ...llm, connection_id: connection_id || undefined })}
            size="sm"
          />
        </Box>
      </VStack>
    );
  }

  // Query type — determine current source
  const currentSource = (subject.type === 'query' && subject.source === 'inline') ? 'inline' : 'question';

  function handleSourceChange(newSource: 'question' | 'inline') {
    if (newSource === currentSource) return;
    if (newSource === 'inline') {
      onChange({ type: 'query', source: 'inline', sql: '', connection_name: '', column: undefined, row: undefined });
    } else {
      onChange({ type: 'query', source: 'question', question_id: defaultQuestionId ?? 0, column: undefined, row: undefined });
    }
  }

  const sourceOptions = [
    { value: 'question', label: 'Question' },
    { value: 'inline', label: 'Inline SQL' },
  ];

  return (
    <VStack align="stretch" gap={2}>
      {/* Source + Question on same row for question source */}
      {currentSource === 'inline' ? (
        <>
          <HStack gap={2} align="flex-end">
            <Box w="120px" flexShrink={0}>
              <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Source</Text>
              <SimpleSelect
                value={currentSource}
                onChange={v => handleSourceChange(v as 'question' | 'inline')}
                options={sourceOptions}
                disabled={disabled}
              />
            </Box>
          </HStack>
          <InlineSubjectEditor
            subject={subject as Extract<TestSubject, { source: 'inline' }>}
            onChange={onChange}
            disabled={disabled}
          />
        </>
      ) : (
        <>
          <HStack gap={2} align="flex-end">
            <Box w="120px" flexShrink={0}>
              <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Source</Text>
              <SimpleSelect
                value={currentSource}
                onChange={v => handleSourceChange(v as 'question' | 'inline')}
                options={sourceOptions}
                disabled={disabled}
              />
            </Box>
            <Box flex={1}>
              <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Question</Text>
              <QuestionPicker
                selectedId={query.question_id || null}
                onSelect={id => onChange({ ...query, question_id: id, column: undefined })}
                disabled={disabled}
              />
            </Box>
          </HStack>
          <QueryValueSelector
            source={query.question_id > 0 ? { kind: 'question', questionId: query.question_id } : null}
            column={query.column}
            onColumnChange={column => onChange({ ...query, column })}
            row={query.row}
            onRowChange={row => onChange({ ...query, row })}
            disabled={disabled}
          />
        </>
      )}
    </VStack>
  );
}
