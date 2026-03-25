'use client';

import { NativeSelect } from '@chakra-ui/react';
import type { TestAnswerType, TestOperator } from '@/lib/types';

const ALL_OPERATORS: { value: TestOperator; label: string }[] = [
  { value: '=',  label: '= (equals)' },
  { value: '~',  label: '~ (regex match)' },
  { value: '>',  label: '> (greater than)' },
  { value: '>=', label: '>= (greater or equal)' },
  { value: '<',  label: '< (less than)' },
  { value: '<=', label: '<= (less or equal)' },
];

function allowedOperators(answerType: TestAnswerType): TestOperator[] {
  if (answerType === 'binary') return ['='];
  if (answerType === 'string') return ['=', '~'];
  return ['=', '<', '>', '<=', '>='];
}

interface TestOperatorSelectProps {
  answerType: TestAnswerType;
  value: TestOperator;
  onChange: (op: TestOperator) => void;
  disabled?: boolean;
}

export default function TestOperatorSelect({ answerType, value, onChange, disabled }: TestOperatorSelectProps) {
  const allowed = allowedOperators(answerType);
  // If current value isn't allowed for this answerType, reset to '='
  const safeValue: TestOperator = allowed.includes(value) ? value : '=';

  return (
    <NativeSelect.Root size="sm" disabled={disabled}>
      <NativeSelect.Field
        value={safeValue}
        onChange={e => onChange(e.target.value as TestOperator)}
      >
        {ALL_OPERATORS.filter(op => allowed.includes(op.value)).map(op => (
          <option key={op.value} value={op.value}>{op.label}</option>
        ))}
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  );
}
