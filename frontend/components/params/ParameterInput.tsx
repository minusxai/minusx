'use client';

import React from 'react';
import { Input, HStack, Text, Box } from '@chakra-ui/react';
import { LuBan } from 'react-icons/lu';
import { Tooltip } from '@/components/ui/tooltip';
import { QuestionParameter } from '@/lib/types';
import type { QuestionParameterSource, SqlParameterSource } from '@/lib/validation/atlas-schemas';
import { getTypeColor, getTypeIcon } from '@/lib/sql/param-type-display';
import { getParameterDisplayName } from '@/lib/sql/sql-params';
import DatePicker from '../selectors/DatePicker';
import { SourceDropdownWidget } from './SourceDropdownWidget';
import { InlineSqlDropdownWidget } from './InlineSqlDropdownWidget';
import { SourceConfigPopover } from './SourceConfigPopover';
import { ROW_H } from './paramInputShared';

// Re-exported so existing consumers (e.g. StoryParamControl) can keep importing
// `SourceDropdownWidget` from '@/components/params/ParameterInput' unchanged.
export { SourceDropdownWidget } from './SourceDropdownWidget';

// ─── ParameterInput ───────────────────────────────────────────────────────────

interface ParameterInputProps {
  parameter: QuestionParameter;
  value: string | number | null | undefined;
  onChange: (value: string | number | null) => void;
  onTypeChange: (type: 'text' | 'number' | 'date') => void;
  onParameterChange?: (updated: QuestionParameter) => void;
  onSubmit?: (paramName?: string, value?: string | number) => void;
  disableTypeChange?: boolean;
  disableSourceConfig?: boolean;
  onHoverParam?: (key: string | null) => void;
  database?: string;
}

export default function ParameterInput({
  parameter,
  value,
  onChange,
  onTypeChange,
  onParameterChange,
  onSubmit,
  disableTypeChange = false,
  disableSourceConfig = false,
  onHoverParam,
  database,
}: ParameterInputProps) {
  const paramKey = `${parameter.name}-${parameter.type}`;
  const hasQuestionSource = parameter.source?.type === 'question' && !!parameter.source.column;
  const hasSqlSource = parameter.source?.type === 'sql' && !!parameter.source.query;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parameter.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value;
    onChange(newValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) && onSubmit) {
      e.preventDefault();
      e.stopPropagation();
      const currentValue = parameter.type === 'number'
        ? parseFloat(e.currentTarget.value) || 0
        : e.currentTarget.value;
      onSubmit(parameter.name, currentValue);
    }
  };

  const handleDateChange = (newValue: string) => {
    onChange(newValue);
    if (onSubmit) {
      onSubmit(parameter.name, newValue);
    }
  };

  const isNone = value === null;


  return (
    <HStack
      gap={0}
      bg="bg.muted"
      borderRadius="md"
      border="1px solid"
      borderColor="border.muted"
      h={ROW_H}
      align="center"
      onMouseEnter={() => onHoverParam?.(paramKey)}
      onMouseLeave={() => onHoverParam?.(null)}
      overflow="hidden"
    >
      {/* Param label — shows the friendly display name; tooltip reveals the raw :name binding */}
      <Tooltip content={`:${parameter.name}`} positioning={{ placement: 'top-start' }}>
        <HStack
          gap={1}
          px={2}
          h="full"
          bg={`${getTypeColor(parameter.type)}/20`}
          color="fg.emphasized"
          fontSize="xs"
          fontWeight="600"
          fontFamily="mono"
          flexShrink={0}
          borderLeft="3px solid"
          borderLeftColor={getTypeColor(parameter.type)}
        >
          {React.createElement(getTypeIcon(parameter.type), { size: 11 })}
          <Text aria-label={`Parameter ${parameter.name}`} fontSize="xs" fontFamily="mono" fontWeight="600">{getParameterDisplayName(parameter)}</Text>
        </HStack>
      </Tooltip>

      {/* Value area */}
      {isNone ? (
        <HStack
          px={2}
          h="full"
          gap={1}
          cursor="pointer"
          onClick={() => onChange('')}
          color="accent.danger"
          _hover={{ bg: 'accent.danger/10' }}
          transition="all 0.1s"
        >
          <LuBan style={{ width: 10, height: 10 }} />
          <Text fontSize="xs" fontWeight="600" fontFamily="mono">Skipped</Text>
        </HStack>
      ) : (
        hasQuestionSource && parameter.type !== 'date' ? (
          <SourceDropdownWidget
            key={String(value ?? '')}
            source={parameter.source as QuestionParameterSource}
            paramType={parameter.type as 'text' | 'number'}
            currentValue={value ?? undefined}
            paramName={parameter.name}
            onChange={onChange}
            onSubmit={onSubmit}
          />
        ) : hasSqlSource && parameter.type !== 'date' ? (
          <InlineSqlDropdownWidget
            key={String(value ?? '')}
            source={parameter.source as SqlParameterSource}
            paramType={parameter.type as 'text' | 'number'}
            currentValue={value ?? undefined}
            paramName={parameter.name}
            database={database}
            onChange={onChange}
            onSubmit={onSubmit}
          />
        ) : parameter.type === 'date' ? (
          <DatePicker
            value={typeof value === 'string' ? value : ''}
            onChange={handleDateChange}
            placeholder="YYYY-MM-DD"
            ariaLabel={parameter.name}
          />
        ) : (
          <Input
            value={value ?? ''}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            type={parameter.type === 'number' ? 'number' : 'text'}
            w="100px"
            bg="transparent"
            border="none"
            fontFamily="mono"
            fontSize="xs"
            px={2}
            h="full"
            borderRadius={0}
            _focus={{
              outline: 'none',
              boxShadow: 'none',
            }}
            placeholder={parameter.type === 'number' ? '0' : 'value'}
            aria-label={parameter.name}
          />
        )
      )}

      {/* Actions */}
      {!isNone && (
        <Tooltip content="Skip this filter">
          <Box
            as="button"
            px={1.5}
            h="full"
            display="flex"
            alignItems="center"
            color="fg.subtle"
            cursor="pointer"
            _hover={{ color: 'accent.danger', bg: 'accent.danger/10' }}
            transition="all 0.1s"
            onClick={() => onChange(null)}
            aria-label="Skip this filter"
          >
            <LuBan style={{ width: 11, height: 11 }} />
          </Box>
        </Tooltip>
      )}

      {!disableSourceConfig && onParameterChange && (
        <SourceConfigPopover
          parameter={parameter}
          onParameterChange={onParameterChange}
          onTypeChange={disableTypeChange ? undefined : onTypeChange}
          disableTypeChange={disableTypeChange}
        />
      )}
    </HStack>
  );
}
