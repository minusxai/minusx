'use client';

import { useMemo } from 'react';
import type { TestAnswerType, TestOperator } from '@/lib/types';
import SimpleSelect from './SimpleSelect';

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

  const options = useMemo(
    () => ALL_OPERATORS.filter(op => allowed.includes(op.value)),
    [allowed],
  );

  return (
    <SimpleSelect
      value={safeValue}
      onChange={v => onChange(v as TestOperator)}
      options={options}
      disabled={disabled}
    />
  );
}
