'use client';

import { HStack, IconButton } from '@chakra-ui/react';
import { LuPlay } from 'react-icons/lu';
import { Tooltip } from '@/components/ui/tooltip';
import { QuestionParameter } from '@/lib/types';
import ParameterInput from './ParameterInput';

interface ParameterRowProps {
  parameters: QuestionParameter[];
  parameterValues?: Record<string, any>;        // current values (from file content)
  lastSubmittedValues?: Record<string, any>;     // values last used for execution
  onValueChange?: (paramName: string, value: string | number | null) => void;
  onSubmit: (paramValues: Record<string, any>) => void;  // submit for execution
  onParametersChange?: (parameters: QuestionParameter[]) => void;  // structural
  disableTypeChange?: boolean;
  onHoverParam?: (key: string | null) => void;
  database?: string;
}

export default function ParameterRow({
  parameters,
  parameterValues,
  lastSubmittedValues,
  onValueChange,
  onSubmit,
  onParametersChange,
  disableTypeChange = false,
  onHoverParam,
  database,
}: ParameterRowProps) {
  // Compute effective value per param: prefer local edit value, fall back to last submitted value
  const getEffectiveValue = (param: QuestionParameter): string | number | null | undefined => {
    // Use 'in' check so that an explicit null (None state) is not skipped by ??
    if (parameterValues && param.name in parameterValues) return parameterValues[param.name];
    return lastSubmittedValues?.[param.name];
  };

  const handleValueChange = (paramName: string, value: string | number | null) => {
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
        const v = getEffectiveValue(p);
        valuesDict[p.name] = v !== undefined ? v : '';  // preserve null (None state)
      }
    }

    onSubmit(valuesDict);
  };

  // Dirty detection: any param's effective value differs from lastSubmittedValues
  const isDirty = lastSubmittedValues !== undefined && parameters.some(p => {
    const effective = getEffectiveValue(p);
    const submitted = lastSubmittedValues[p.name];
    // null (None) vs undefined/empty: treat both undefined and '' as "no value"
    const normalizeForDirty = (v: string | number | null | undefined) =>
      v === null ? '__none__' : String(v ?? '');
    return normalizeForDirty(effective) !== normalizeForDirty(submitted);
  });

  const handleTypeChange = (paramName: string, type: 'text' | 'number' | 'date') => {
    const updatedParams = parameters.map((p) =>
      p.name === paramName ? { ...p, type } : p
    );
    if (onParametersChange) {
      onParametersChange(updatedParams);
    }
  };

  const handleParameterUpdate = (updated: QuestionParameter) => {
    const updatedParams = parameters.map((p) =>
      p.name === updated.name ? updated : p
    );
    onParametersChange?.(updatedParams);
  };

  return (
    <HStack gap={3} flexWrap="wrap" align="center" mt={4} mb={2}>
      {parameters.map((param) => (
        <ParameterInput
          key={param.name}
          parameter={param}
          value={getEffectiveValue(param)}
          onChange={(value) => handleValueChange(param.name, value as string | number | null)}
          onTypeChange={(type) => handleTypeChange(param.name, type)}
          onParameterChange={handleParameterUpdate}
          onSubmit={handleSubmit}
          disableTypeChange={disableTypeChange}
          disableSourceConfig={disableTypeChange}
          onHoverParam={onHoverParam}
          database={database}
        />
      ))}
      {isDirty && (
        <Tooltip content="Run with updated values (⌘+Enter)">
          <IconButton
            aria-label="Run query"
            size="xs"
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
