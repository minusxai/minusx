'use client';

import { VStack, HStack, Text, Box, Separator } from '@chakra-ui/react';
import { useMemo } from 'react';
import type { Test, TestAnswerType } from '@/lib/types';
import TestSubjectEditor from './TestSubjectEditor';
import TestOperatorSelect from './TestOperatorSelect';
import TestValueEditor from './TestValueEditor';
import SimpleSelect from './SimpleSelect';

function makeDefaultTest(type: 'llm' | 'query', defaultQuestionId?: number): Test {
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
    subject: { type: 'query', question_id: defaultQuestionId ?? 0 },
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
  /** Pre-fill subject question_id for new query tests */
  defaultQuestionId?: number;
}

const TYPE_OPTIONS = [
  { value: 'query', label: 'Query' },
  { value: 'llm', label: 'LLM' },
];

const ANSWER_TYPE_OPTIONS_ALL = [
  { value: 'binary', label: 'Binary (yes/no)' },
  { value: 'number', label: 'Number' },
  { value: 'string', label: 'String' },
];

const ANSWER_TYPE_OPTIONS_QUERY = ANSWER_TYPE_OPTIONS_ALL.filter(o => o.value !== 'binary');

export default function TestEditor({ test, onChange, forcedType, disabled, defaultQuestionId }: TestEditorProps) {
  const answerTypeOptions = useMemo(
    () => test.type === 'query' ? ANSWER_TYPE_OPTIONS_QUERY : ANSWER_TYPE_OPTIONS_ALL,
    [test.type],
  );
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

  const sourceHeading = test.type === 'llm' ? '1. Prompt' : '1. Source';

  return (
    <VStack align="stretch" gap={3}>
      {/* Test type */}
      {!forcedType && (
        <HStack gap={2} align="center">
          <Text fontSize="xs" color="fg.muted" fontWeight="500" flexShrink={0} w="60px">Type</Text>
          <Box flex={1}>
            <SimpleSelect
              value={test.type}
              onChange={v => handleTypeChange(v as 'llm' | 'query')}
              options={TYPE_OPTIONS}
              disabled={disabled}
            />
          </Box>
        </HStack>
      )}

      {/* 1. Source */}
      <Box>
        <Text fontSize="xs" fontWeight="600" color="fg.default" mb={2}>{sourceHeading}</Text>
        <TestSubjectEditor
          subject={test.subject}
          testType={test.type}
          onChange={subject => onChange({ ...test, subject })}
          disabled={disabled}
          defaultQuestionId={defaultQuestionId}
        />
      </Box>

      <Separator />

      {/* 2. Condition */}
      {test.value.type !== 'cannot_answer' && (
        <Box>
          <Text fontSize="xs" fontWeight="600" color="fg.default" mb={2}>2. Condition</Text>
          <HStack gap={2} align="flex-end">
            <Box flex={1}>
              <Text fontSize="xs" color="fg.muted" mb={1} fontWeight="500">Answer type</Text>
              <SimpleSelect
                value={test.answerType}
                onChange={v => handleAnswerTypeChange(v as TestAnswerType)}
                options={answerTypeOptions}
                disabled={disabled}
              />
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
        </Box>
      )}

      <Separator />

      {/* 3. Expected value */}
      <Box>
        <Text fontSize="xs" fontWeight="600" color="fg.default" mb={2}>3. Expected value</Text>
        <TestValueEditor
          value={test.value}
          answerType={test.answerType}
          onChange={value => onChange({ ...test, value })}
          disabled={disabled}
          allowCannotAnswer={test.type === 'llm'}
        />
      </Box>
    </VStack>
  );
}

export { makeDefaultTest };
