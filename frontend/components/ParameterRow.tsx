'use client';

import { HStack, IconButton } from '@chakra-ui/react';
import { LuPlay } from 'react-icons/lu';
import { Tooltip } from '@/components/ui/tooltip';
import { QuestionParameter } from '@/lib/types';
import ParameterInput from './ParameterInput';

interface ParameterRowProps {
  parameters: QuestionParameter[];
  parameterValues?: Record<string, any>;        // ephemeral runtime values
  lastSubmittedValues?: Record<string, any>;     // values last used for execution
  onValueChange?: (paramName: string, value: string | number) => void;  // ephemeral
  onSubmit: (paramValues: Record<string, any>) => void;  // submit for execution
  onParametersChange?: (parameters: QuestionParameter[]) => void;  // structural
  onSetDefault?: (paramName: string, value: string | number | undefined) => void;
  disableTypeChange?: boolean;
  disableSetDefault?: boolean;
  onHoverParam?: (key: string | null) => void;
}

export default function ParameterRow({
  parameters,
  parameterValues,
  lastSubmittedValues,
  onValueChange,
  onSubmit,
  onParametersChange,
  onSetDefault,
  disableTypeChange = false,
  disableSetDefault = false,
  onHoverParam,
}: ParameterRowProps) {
  // Compute effective value per param: ephemeral → defaultValue → undefined
  const getEffectiveValue = (param: QuestionParameter): string | number | undefined => {
    const ephemeral = parameterValues?.[param.name];
    if (ephemeral !== undefined) return ephemeral;
    if (param.defaultValue !== undefined && param.defaultValue !== null) return param.defaultValue;
    return undefined;
  };

  const handleValueChange = (paramName: string, value: string | number) => {
    if (onValueChange) {
      onValueChange(paramName, value);
    }
  };

  // Handle submit: build effective values dict and call onSubmit
  const handleSubmit = (paramName?: string, value?: string | number) => {
    const valuesDict: Record<string, any> = {};

    for (const p of parameters) {
      // If this is the param being submitted with a new value, use that value
      if (paramName !== undefined && p.name === paramName && value !== undefined) {
        valuesDict[p.name] = value;
        // Also update ephemeral state
        if (onValueChange) {
          onValueChange(paramName, value);
        }
      } else {
        valuesDict[p.name] = getEffectiveValue(p) ?? '';
      }
    }

    onSubmit(valuesDict);
  };

  // Dirty detection: any param's effective value differs from lastSubmittedValues
  const isDirty = lastSubmittedValues !== undefined && parameters.some(p => {
    const effective = String(getEffectiveValue(p) ?? '');
    const submitted = String(lastSubmittedValues[p.name] ?? '');
    return effective !== submitted;
  });

  const handleTypeChange = (paramName: string, type: 'text' | 'number' | 'date') => {
    const updatedParams = parameters.map((p) =>
      p.name === paramName ? { ...p, type } : p
    );
    if (onParametersChange) {
      onParametersChange(updatedParams);
    }
  };

  return (
    <HStack gap={3} flexWrap="wrap" align="center" mt={4} mb={2}>
      {parameters.map((param) => (
        <ParameterInput
          key={param.name}
          parameter={param}
          value={getEffectiveValue(param)}
          defaultValue={param.defaultValue}
          onChange={(value) => handleValueChange(param.name, value)}
          onTypeChange={(type) => handleTypeChange(param.name, type)}
          onSubmit={handleSubmit}
          onSetDefault={onSetDefault ? (value) => onSetDefault(param.name, value) : undefined}
          disableTypeChange={disableTypeChange}
          disableSetDefault={disableSetDefault}
          onHoverParam={onHoverParam}
        />
      ))}
      {isDirty && (
        <Tooltip content="Run with updated values (⌘+Enter)">
          <IconButton
            aria-label="Run query"
            size="sm"
            variant="solid"
            colorPalette="teal"
            px={2}
            onClick={() => handleSubmit()}
          >
            <LuPlay />
            Rerun
          </IconButton>
        </Tooltip>
      )}
    </HStack>
  );
}
