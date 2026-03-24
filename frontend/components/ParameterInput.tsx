'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Input, HStack, Text, MenuRoot, MenuTrigger, MenuContent, MenuItem,
  Portal, MenuPositioner, Box, IconButton, VStack, Popover, NativeSelect, Spinner, Field,
} from '@chakra-ui/react';
import { LuChevronDown, LuX, LuSettings2, LuTriangleAlert } from 'react-icons/lu';
import { Tooltip } from '@/components/ui/tooltip';
import { QuestionParameter, QuestionContent } from '@/lib/types';
import type { ParameterSource } from '@/lib/types.gen';
import { getTypeColor, getTypeColorHex, getTypeIcon } from '@/lib/sql/sql-params';
import DatePicker from './DatePicker';
import { useFile, useFilesByCriteria, useQueryResult } from '@/lib/hooks/file-state-hooks';
import FileSearchSelect from './shared/FileSearchSelect';

const ROW_H = '32px';

// Numeric SQL type patterns (sqlglot output)
const NUMERIC_TYPE_RE = /^(int|integer|bigint|smallint|tinyint|float|double|decimal|numeric|number|real|int2|int4|int8|uint|ubigint|float4|float8|hugeint)/i;

function isNumericType(type: string): boolean {
  return NUMERIC_TYPE_RE.test(type.trim());
}

// ─── Source Dropdown Widget ───────────────────────────────────────────────────
// Rendered in place of the text/number Input when parameter.source is set.

interface SourceDropdownWidgetProps {
  source: ParameterSource;
  paramType: 'text' | 'number';
  currentValue: string | number | undefined;
  paramName: string;
  onChange: (value: string | number) => void;
  onSubmit?: (paramName?: string, value?: string | number) => void;
}

function SourceDropdownWidget({ source, paramType, currentValue, paramName, onChange, onSubmit }: SourceDropdownWidgetProps) {
  const augmented = useFile(source.id);
  const content = augmented?.fileState.content as QuestionContent | undefined | null;

  const { data, loading, error } = useQueryResult(
    content?.query ?? '',
    (content?.parameterValues ?? {}) as Record<string, any>,
    content?.database_name ?? '',
    content?.references ?? undefined,
    { skip: !content?.query }
  );

  // Extract distinct sorted values from source.column (rows are Record<string, any>)
  const values = useMemo<string[] | null>(() => {
    if (!data?.rows) return null;
    if (!source.column) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const row of data.rows) {
      const v = row[source.column];
      if (v !== null && v !== undefined) {
        const str = String(v);
        if (!seen.has(str)) {
          seen.add(str);
          result.push(str);
        }
      }
    }
    return result.sort();
  }, [data, source.column]);

  const handleSelectChange = (raw: string) => {
    const final: string | number = paramType === 'number' ? (parseFloat(raw) || 0) : raw;
    onChange(final);
    onSubmit?.(paramName, final);
  };

  // Loading with no data yet
  if (loading && values === null) {
    return (
      <HStack h={ROW_H} px={2} gap={1.5}>
        <Spinner size="xs" color="accent.teal" />
        <Text fontSize="xs" color="fg.subtle">Loading…</Text>
      </HStack>
    );
  }

  // Error or no values — fall back to free text input with warning icon
  if (error || (values !== null && values.length === 0)) {
    const tooltipMsg = error
      ? 'Could not load values — enter manually'
      : 'No values found — enter manually';
    return (
      <HStack gap={1}>
        <Tooltip content={tooltipMsg}>
          <Box color="orange.400" display="flex" alignItems="center">
            <LuTriangleAlert size={14} />
          </Box>
        </Tooltip>
        <Input
          value={currentValue ?? ''}
          onChange={(e) => {
            const v = paramType === 'number' ? parseFloat(e.target.value) || 0 : e.target.value;
            onChange(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onSubmit) {
              const v = paramType === 'number' ? parseFloat(e.currentTarget.value) || 0 : e.currentTarget.value;
              onSubmit(paramName, v);
            }
          }}
          type={paramType === 'number' ? 'number' : 'text'}
          minW="100px"
          bg="bg.canvas"
          borderColor="border.muted"
          fontSize="sm"
          px={3}
          h={ROW_H}
          placeholder={paramType === 'number' ? '0' : 'value'}
        />
      </HStack>
    );
  }

  return (
    <NativeSelect.Root size="sm" minW="120px">
      <NativeSelect.Field
        value={currentValue !== undefined && currentValue !== null ? String(currentValue) : ''}
        onChange={(e) => handleSelectChange(e.target.value)}
        h={ROW_H}
        fontSize="sm"
        bg="bg.canvas"
        borderColor="border.muted"
      >
        <option value="">— select —</option>
        {(values ?? []).map(v => (
          <option key={v} value={v}>{v}</option>
        ))}
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  );
}

// ─── Source Config Popover ────────────────────────────────────────────────────
// Settings gear that opens a popover to configure parameter.source.

interface SourceConfigPopoverProps {
  parameter: QuestionParameter;
  onParameterChange: (updated: QuestionParameter) => void;
}

function SourceConfigPopover({ parameter, onParameterChange }: SourceConfigPopoverProps) {
  const [open, setOpen] = useState(false);
  const [columns, setColumns] = useState<{ name: string; type: string }[]>([]);
  const [loadingCols, setLoadingCols] = useState(false);

  // Local mode state: 'manual' | 'question'. Tracks the toggle, even before question is selected.
  const isFromQuestion = parameter.source?.type === 'question';
  const [mode, setMode] = useState<'manual' | 'question'>(isFromQuestion ? 'question' : 'manual');

  const sourceQuestionId = parameter.source?.type === 'question' ? parameter.source.id : null;

  // Pre-fetch columns when popover opens with an existing question source
  useEffect(() => {
    if (open && sourceQuestionId) {
      fetchColumns(sourceQuestionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { files: questionFiles } = useFilesByCriteria({ criteria: { type: 'question' }, partial: true });
  const questionList = useMemo(
    () => questionFiles.map(f => ({ id: f.id, name: f.name || String(f.id) })),
    [questionFiles]
  );

  async function fetchColumns(questionId: number) {
    setLoadingCols(true);
    try {
      const res = await fetch('/api/infer-columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId }),
      });
      const data = await res.json();
      setColumns(data.columns ?? []);
    } catch {
      setColumns([]);
    } finally {
      setLoadingCols(false);
    }
  }

  const filteredColumns = useMemo(() => {
    if (parameter.type === 'number') return columns.filter(c => isNumericType(c.type));
    return columns;
  }, [columns, parameter.type]);

  const handleModeChange = (newMode: 'manual' | 'question') => {
    setMode(newMode);
    if (newMode === 'manual') {
      onParameterChange({ ...parameter, source: null });
      setColumns([]);
    }
    // Switching to 'question': wait for user to pick a question before setting source
  };

  const handleQuestionSelect = (id: number) => {
    onParameterChange({ ...parameter, source: { type: 'question', id, column: '' } });
    fetchColumns(id);
  };

  const handleColumnSelect = (column: string) => {
    if (!sourceQuestionId) return;
    onParameterChange({ ...parameter, source: { type: 'question', id: sourceQuestionId, column } });
  };

  return (
    <Popover.Root open={open} onOpenChange={(d) => setOpen(d.open)} positioning={{ placement: 'bottom-end' }}>
      <Popover.Trigger asChild>
        <Tooltip content="Configure parameter source">
          <IconButton
            aria-label="Configure source"
            variant="ghost"
            h={ROW_H}
            w={ROW_H}
            minW={ROW_H}
            color={isFromQuestion ? 'accent.teal' : 'fg.subtle'}
            _hover={{ color: 'accent.teal', bg: 'bg.emphasized' }}
          >
            <LuSettings2 style={{ width: 13, height: 13 }} />
          </IconButton>
        </Tooltip>
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content width="280px" bg="bg.elevated" p={0} overflow="hidden" borderRadius="lg">
            <Popover.Body p={3} bg="bg.elevated">
              <VStack gap={3} align="stretch">
                <Field.Root>
                  <Field.Label fontSize="xs" fontWeight="600">Source</Field.Label>
                  <NativeSelect.Root size="sm">
                    <NativeSelect.Field
                      value={mode}
                      onChange={(e) => handleModeChange(e.target.value as 'manual' | 'question')}
                    >
                      <option value="manual">Free input</option>
                      <option value="question">From question</option>
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </Field.Root>

                {mode === 'question' && (
                  <>
                    <Field.Root>
                      <Field.Label fontSize="xs" fontWeight="600">Question</Field.Label>
                      <FileSearchSelect
                        files={questionList}
                        selectedId={sourceQuestionId}
                        onSelect={handleQuestionSelect}
                        placeholder="Search questions…"
                      />
                    </Field.Root>

                    {sourceQuestionId && (
                      <Field.Root>
                        <Field.Label fontSize="xs" fontWeight="600">
                          Column
                          {parameter.type === 'number' && (
                            <Text as="span" fontSize="2xs" color="fg.subtle" ml={1}>(numeric only)</Text>
                          )}
                        </Field.Label>
                        <NativeSelect.Root size="sm">
                          <NativeSelect.Field
                            value={parameter.source?.column ?? ''}
                            onChange={(e) => handleColumnSelect(e.target.value)}
                            aria-disabled={loadingCols}
                          >
                            <option value="">
                              {loadingCols ? 'Loading…' : filteredColumns.length === 0 ? 'No columns found' : '— select column —'}
                            </option>
                            {filteredColumns.map(c => (
                              <option key={c.name} value={c.name}>{c.name}</option>
                            ))}
                          </NativeSelect.Field>
                          <NativeSelect.Indicator />
                        </NativeSelect.Root>
                      </Field.Root>
                    )}
                  </>
                )}
              </VStack>
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}

// ─── ParameterInput ───────────────────────────────────────────────────────────

interface ParameterInputProps {
  parameter: QuestionParameter;
  value: string | number | undefined;
  onChange: (value: string | number) => void;
  onTypeChange: (type: 'text' | 'number' | 'date') => void;
  onParameterChange?: (updated: QuestionParameter) => void;
  onSubmit?: (paramName?: string, value?: string | number) => void;
  disableTypeChange?: boolean;
  disableSourceConfig?: boolean;
  onHoverParam?: (key: string | null) => void;
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
}: ParameterInputProps) {
  const paramKey = `${parameter.name}-${parameter.type}`;
  const hasSource = parameter.source?.type === 'question' && !!parameter.source.column;

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

  const hasValue = value !== undefined && value !== '' && value !== null;

  const typeOptions: Array<{ type: 'text' | 'number' | 'date'; label: string }> = [
    { type: 'text', label: 'Text' },
    { type: 'number', label: 'Number' },
    { type: 'date', label: 'Date' },
  ];

  // Whether to show source config (not for date params, not in dashboard view)
  const showSourceConfig = !disableSourceConfig && parameter.type !== 'date';

  return (
    <Box
      position="relative"
      p={2}
      pt={4}
      bg="bg.muted"
      borderRadius="md"
      border="1px solid"
      borderColor="border.default"
      onMouseEnter={() => onHoverParam?.(paramKey)}
      onMouseLeave={() => onHoverParam?.(null)}
    >
      {/* Parameter name - floating label (top left) */}
      <Text
        position="absolute"
        top={-2}
        left={2}
        fontSize="xs"
        fontWeight="600"
        color="white"
        fontFamily="mono"
        bg={getTypeColor(parameter.type)}
        borderRadius={5}
        px={2}
      >
        :{parameter.name}
      </Text>

      <HStack gap={1.5} align="center">

        {/* Input field — dropdown when source is configured, otherwise standard input */}
        {hasSource && parameter.type !== 'date' ? (
          <SourceDropdownWidget
            source={parameter.source!}
            paramType={parameter.type as 'text' | 'number'}
            currentValue={value}
            paramName={parameter.name}
            onChange={onChange}
            onSubmit={onSubmit}
          />
        ) : parameter.type === 'date' ? (
          <DatePicker
            value={typeof value === 'string' ? value : ''}
            onChange={handleDateChange}
            placeholder="YYYY-MM-DD"
          />
        ) : (
          <Input
            value={value ?? ''}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            type={parameter.type === 'number' ? 'number' : 'text'}
            minW="100px"
            bg="bg.canvas"
            borderColor="border.muted"
            fontFamily={parameter.type === 'number' ? 'mono' : 'inherit'}
            fontSize="sm"
            px={3}
            h={ROW_H}
            _focus={{
              borderColor: 'accent.teal',
              boxShadow: '0 0 0 1px var(--chakra-colors-accent-teal)',
            }}
            placeholder={parameter.type === 'number' ? '0' : 'value'}
          />
        )}

        {/* Clear button: visible when value is non-empty and not using dropdown */}
        {hasValue && !hasSource && (
          <Tooltip content="Clear value">
            <IconButton
              aria-label="Clear value"
              variant="ghost"
              onClick={() => onChange('')}
              color="fg.subtle"
              h={ROW_H}
              w={ROW_H}
              minW={ROW_H}
              _hover={{ color: 'accent.danger', bg: 'bg.emphasized' }}
            >
              <LuX style={{ width: 10, height: 10 }} />
            </IconButton>
          </Tooltip>
        )}

        {/* Source config gear (text/number only, hidden in dashboard view) */}
        {showSourceConfig && onParameterChange && (
          <SourceConfigPopover
            parameter={parameter}
            onParameterChange={onParameterChange}
          />
        )}

        {/* Type selector - dropdown or read-only indicator (hidden when source is configured) */}
        {!hasSource && (
          disableTypeChange ? (
            <HStack
              gap={1}
              px={2}
              h={ROW_H}
              bg="bg.canvas"
              borderRadius="sm"
              border="1px solid"
              borderColor="border.muted"
              fontSize="xs"
              fontWeight="600"
              style={{ color: getTypeColorHex(parameter.type) }}
              align="center"
            >
              {React.createElement(getTypeIcon(parameter.type), { size: 16 })}
            </HStack>
          ) : (
            <Tooltip content="Change parameter type">
              <MenuRoot positioning={{ placement: 'bottom' }}>
                <MenuTrigger asChild>
                  <HStack
                    as="button"
                    gap={1}
                    px={2}
                    h={ROW_H}
                    bg="bg.canvas"
                    borderRadius="sm"
                    border="1px solid"
                    borderColor="border.muted"
                    cursor="pointer"
                    fontSize="xs"
                    fontWeight="600"
                    style={{ color: getTypeColorHex(parameter.type) }}
                    _hover={{
                      bg: 'bg.surface',
                      borderColor: 'accent.teal',
                    }}
                    align="center"
                  >
                    {React.createElement(getTypeIcon(parameter.type), { size: 16 })}
                    <LuChevronDown size={12} />
                  </HStack>
                </MenuTrigger>
                <Portal>
                  <MenuPositioner>
                    <MenuContent minW="120px" p={1}>
                      {typeOptions.map((option) => (
                        <MenuItem
                          key={option.type}
                          value={option.type}
                          style={{ color: getTypeColorHex(option.type) }}
                          onClick={() => onTypeChange(option.type)}
                          px={3}
                          py={2}
                          borderRadius="sm"
                        >
                          <HStack gap={2}>
                            {React.createElement(getTypeIcon(option.type), { size: 16 })}
                            <Text fontSize="sm" fontWeight="600" fontFamily="mono">
                              {option.label}
                            </Text>
                          </HStack>
                        </MenuItem>
                      ))}
                    </MenuContent>
                  </MenuPositioner>
                </Portal>
              </MenuRoot>
            </Tooltip>
          )
        )}
      </HStack>
    </Box>
  );
}
