'use client';

import { VStack, HStack, Text, Input, NativeSelect, Box, Separator } from '@chakra-ui/react';
import type { Test, TestAnswerType } from '@/lib/types';
import TestSubjectEditor from './TestSubjectEditor';
import TestOperatorSelect from './TestOperatorSelect';
import TestValueEditor from './TestValueEditor';

function makeDefaultTest(type: 'llm' | 'query'): Test {
  if (type === 'llm') {
    return {
      type: 'llm',
      subject: { type: 'llm', prompt: '', context: { type: 'explore' } },
      answerType: 'binary',
      operator: '=',
      value: { type: 'constant', value: true },
    };
  }
  return {
    type: 'query',
    subject: { type: 'query', question_id: 0 },
    answerType: 'number',
    operator: '=',
    value: { type: 'constant', value: 0 },
  };
}

interface TestEditorProps {
  test: Test;
  onChange: (test: Test) => void;
  /** If provided, only allow this test type (e.g. evals are llm-only) */
  forcedType?: 'llm' | 'query';
  disabled?: boolean;
}

export default function TestEditor({ test, onChange, forcedType, disabled }: TestEditorProps) {
  function handleTypeChange(newType: 'llm' | 'query') {
    if (newType === test.type) return;
    onChange(makeDefaultTest(newType));
  }

  function handleAnswerTypeChange(newAnswerType: TestAnswerType) {
    // Reset operator and value when answer type changes
    const defaultOp = newAnswerType === 'binary' ? '=' : newAnswerType === 'string' ? '=' : '=';
    const defaultValue = newAnswerType === 'binary'
      ? { type: 'constant' as const, value: true }
      : newAnswerType === 'number'
        ? { type: 'constant' as const, value: 0 }
        : { type: 'constant' as const, value: '' };
    onChange({ ...test, answerType: newAnswerType, operator: defaultOp, value: defaultValue });
  }

  return (
    <VStack align="stretch" gap={3}>
      {/* Test type */}
      {!forcedType && (
        <HStack gap={2} align="center">
          <Text fontSize="xs" color="fg.muted" fontWeight="500" flexShrink={0} w="60px">Type</Text>
          <NativeSelect.Root size="sm" flex={1} disabled={disabled}>
            <NativeSelect.Field
              value={test.type}
              onChange={e => handleTypeChange(e.target.value as 'llm' | 'query')}
            >
              <option value="query">Query</option>
              <option value="llm">LLM</option>
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </HStack>
      )}

      {/* Label (optional) */}
      <HStack gap={2} align="center">
        <Text fontSize="xs" color="fg.muted" fontWeight="500" flexShrink={0} w="60px">Label</Text>
        <Input
          value={test.label ?? ''}
          onChange={e => onChange({ ...test, label: e.target.value || undefined })}
          placeholder="Optional description"
          size="sm"
          bg="bg.surface"
          fontSize="xs"
          disabled={disabled}
          flex={1}
        />
      </HStack>

      <Separator />

      {/* Subject */}
      <Box>
        <Text fontSize="xs" color="fg.muted" fontWeight="600" mb={2}>
          {test.type === 'llm' ? 'Prompt' : 'Source'}
        </Text>
        <TestSubjectEditor
          subject={test.subject}
          testType={test.type}
          onChange={subject => onChange({ ...test, subject })}
          disabled={disabled}
        />
      </Box>

      <Separator />

      {/* Answer type + operator */}
      <HStack gap={2} align="flex-start">
        <Box flex={1}>
          <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Answer type</Text>
          <NativeSelect.Root size="sm" disabled={disabled}>
            <NativeSelect.Field
              value={test.answerType}
              onChange={e => handleAnswerTypeChange(e.target.value as TestAnswerType)}
            >
              {test.type !== 'query' && <option value="binary">Binary (yes/no)</option>}
              <option value="number">Number</option>
              <option value="string">String</option>
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Box>
        <Box flex={1}>
          <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Operator</Text>
          <TestOperatorSelect
            answerType={test.answerType}
            value={test.operator}
            onChange={operator => onChange({ ...test, operator })}
            disabled={disabled}
          />
        </Box>
      </HStack>

      {/* Expected value */}
      <Box>
        <Text fontSize="xs" color="fg.muted" fontWeight="600" mb={2}>Expected value</Text>
        <TestValueEditor
          value={test.value}
          answerType={test.answerType}
          onChange={value => onChange({ ...test, value })}
          disabled={disabled}
        />
      </Box>
    </VStack>
  );
}

export { makeDefaultTest };
