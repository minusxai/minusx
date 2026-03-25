'use client';

import {
  VStack, HStack, Box, Text, Button, IconButton, Collapsible
} from '@chakra-ui/react';
import { useState, useCallback } from 'react';
import { LuPlus, LuTrash2, LuChevronDown, LuChevronRight, LuPlay } from 'react-icons/lu';
import type { Test, TestRunResult } from '@/lib/types';
import { createClientRunner } from '@/lib/tests/client';
import TestEditor, { makeDefaultTest } from './TestEditor';
import TestResultBadge from './TestResultBadge';

function testLabel(test: Test, index: number): string {
  if (test.label) return test.label;
  if (test.type === 'llm' && test.subject.type === 'llm' && test.subject.prompt) {
    const p = test.subject.prompt;
    return p.length > 50 ? p.slice(0, 47) + '…' : p;
  }
  return `Test ${index + 1}`;
}

interface TestRowProps {
  test: Test;
  index: number;
  editMode: boolean;
  forcedType?: 'llm' | 'query';
  onChange: (test: Test) => void;
  onDelete: () => void;
}

function TestRow({ test, index, editMode, forcedType, onChange, onDelete }: TestRowProps) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestRunResult | null>(null);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setResult(null);
    try {
      const runner = createClientRunner();
      const r = await runner.execute(test);
      setResult(r);
    } finally {
      setRunning(false);
    }
  }, [test]);

  return (
    <Box borderRadius="md" border="1px solid" borderColor="border.muted" overflow="hidden">
      <HStack
        px={3}
        py={2}
        bg="bg.muted"
        cursor="pointer"
        onClick={() => setOpen(o => !o)}
        gap={2}
      >
        <Box color="fg.muted" flexShrink={0}>
          {open ? <LuChevronDown size={14} /> : <LuChevronRight size={14} />}
        </Box>
        <Text fontSize="xs" fontFamily="mono" fontWeight="600" flex={1} color="fg.default" truncate>
          {testLabel(test, index)}
        </Text>

        {/* Result badge */}
        <Box onClick={e => e.stopPropagation()}>
          <TestResultBadge result={result} running={running} showDetails={false} />
        </Box>

        {/* Run button */}
        <IconButton
          size="xs"
          variant="ghost"
          aria-label="Run test"
          onClick={e => { e.stopPropagation(); handleRun(); }}
          disabled={running}
          color="fg.muted"
          _hover={{ color: 'fg.default' }}
        >
          <LuPlay size={12} />
        </IconButton>

        {/* Delete button (edit mode only) */}
        {editMode && (
          <IconButton
            size="xs"
            variant="ghost"
            colorPalette="red"
            aria-label="Delete test"
            onClick={e => { e.stopPropagation(); onDelete(); }}
            color="fg.muted"
            _hover={{ color: 'red.fg' }}
          >
            <LuTrash2 size={12} />
          </IconButton>
        )}
      </HStack>

      <Collapsible.Root open={open}>
        <Collapsible.Content>
          <Box px={3} py={3} borderTopWidth="1px" borderColor="border.muted">
            {/* Inline result details when expanded */}
            {(result || running) && (
              <Box mb={3}>
                <TestResultBadge result={result} running={running} showDetails />
              </Box>
            )}
            {editMode ? (
              <TestEditor
                test={test}
                onChange={onChange}
                forcedType={forcedType}
              />
            ) : (
              <TestReadOnly test={test} />
            )}
          </Box>
        </Collapsible.Content>
      </Collapsible.Root>
    </Box>
  );
}

/** Read-only summary of a test's configuration */
function TestReadOnly({ test }: { test: Test }) {
  const subjectDesc = test.subject.type === 'llm'
    ? `LLM: "${test.subject.prompt}"`
    : `Query #${test.subject.question_id}${test.subject.column ? `.${test.subject.column}` : ''}${test.subject.row !== undefined ? `[${test.subject.row}]` : ''}`;

  const valueDesc = test.value.type === 'constant'
    ? String(test.value.value)
    : `Q#${test.value.question_id}${test.value.column ? `.${test.value.column}` : ''}`;

  return (
    <VStack align="stretch" gap={1}>
      <Text fontSize="xs" color="fg.muted" fontFamily="mono">{subjectDesc}</Text>
      <Text fontSize="xs" color="fg.muted">
        {test.answerType} {test.operator} {valueDesc}
      </Text>
    </VStack>
  );
}

interface TestListProps {
  tests: Test[];
  onChange: (tests: Test[]) => void;
  editMode?: boolean;
  /** If provided, only allow this test type */
  forcedType?: 'llm' | 'query';
}

export default function TestList({ tests, onChange, editMode = false, forcedType }: TestListProps) {
  function handleAdd() {
    onChange([...tests, makeDefaultTest(forcedType ?? 'query')]);
  }

  function handleChange(index: number, updated: Test) {
    const next = [...tests];
    next[index] = updated;
    onChange(next);
  }

  function handleDelete(index: number) {
    onChange(tests.filter((_, i) => i !== index));
  }

  if (tests.length === 0 && !editMode) return null;

  return (
    <VStack align="stretch" gap={2}>
      {tests.map((test, i) => (
        <TestRow
          key={i}
          test={test}
          index={i}
          editMode={editMode}
          forcedType={forcedType}
          onChange={updated => handleChange(i, updated)}
          onDelete={() => handleDelete(i)}
        />
      ))}
      {editMode && (
        <Button size="xs" variant="ghost" onClick={handleAdd} alignSelf="flex-start" color="fg.muted">
          <LuPlus size={12} />
          Add test
        </Button>
      )}
    </VStack>
  );
}
