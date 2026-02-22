'use client';

import { useState, useEffect } from 'react';
import { HStack } from '@chakra-ui/react';
import { QuestionParameter } from '@/lib/types';
import ParameterInput from './ParameterInput';

interface ParameterRowProps {
  parameters: QuestionParameter[];
  onSubmit: (parameters: QuestionParameter[]) => void;
  onParametersChange?: (parameters: QuestionParameter[]) => void;
  disableTypeChange?: boolean;
  onHoverParam?: (key: string | null) => void;
}

export default function ParameterRow({
  parameters,
  onSubmit,
  onParametersChange,
  disableTypeChange = false,
  onHoverParam,
}: ParameterRowProps) {
  const [localParameters, setLocalParameters] = useState<QuestionParameter[]>(parameters);

  // Sync local parameters when props change
  useEffect(() => {
    setLocalParameters(parameters);
  }, [parameters]);

  const handleValueChange = (paramName: string, value: string | number) => {
    const updatedParams = localParameters.map((p) =>
      p.name === paramName ? { ...p, value } : p
    );
    setLocalParameters(updatedParams);
  };

  // Handle submit with optional param update (for Enter key during typing)
  const handleSubmit = (paramName?: string, value?: string | number) => {
    let paramsToSubmit = localParameters;

    // If called with param update, apply it immediately
    if (paramName !== undefined && value !== undefined) {
      paramsToSubmit = localParameters.map((p) =>
        p.name === paramName ? { ...p, value } : p
      );
      setLocalParameters(paramsToSubmit);
    }

    onSubmit(paramsToSubmit);
  };

  const handleTypeChange = (paramName: string, type: 'text' | 'number' | 'date') => {
    const updatedParams = localParameters.map((p) =>
      p.name === paramName ? { ...p, type } : p
    );
    setLocalParameters(updatedParams);
    if (onParametersChange) {
      onParametersChange(updatedParams);
    }
  };

  return (
    <HStack gap={3} flexWrap="wrap" align="center" mt={4} mb={2}>
      {localParameters.map((param) => (
        <ParameterInput
          key={param.name}
          parameter={param}
          value={param.value ?? undefined}
          onChange={(value) => handleValueChange(param.name, value)}
          onTypeChange={(type) => handleTypeChange(param.name, type)}
          onSubmit={handleSubmit}
          disableTypeChange={disableTypeChange}
          onHoverParam={onHoverParam}
        />
      ))}
    </HStack>
  );
}
