'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Input, HStack, Text, MenuRoot, MenuTrigger, MenuContent, MenuItem,
  Portal, MenuPositioner, Box, IconButton, VStack, Popover, Spinner,
  Combobox, createListCollection,
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

// Format a number string to max 2 decimal places, removing trailing zeros
function formatNumStr(v: string): string {
  const n = parseFloat(v);
  if (isNaN(n)) return v;
  return String(parseFloat(n.toFixed(2)));
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

  // Extract distinct values from source.column, formatted for display
  const values = useMemo<string[] | null>(() => {
    if (!data?.rows) return null;
    if (!source.column) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const row of data.rows) {
      const v = row[source.column];
      if (v !== null && v !== undefined) {
        const str = paramType === 'number' ? formatNumStr(String(v)) : String(v);
        if (!seen.has(str)) {
          seen.add(str);
          result.push(str);
        }
      }
    }
    // Sort: numeric order for numbers, lexicographic for text
    return paramType === 'number'
      ? result.sort((a, b) => parseFloat(a) - parseFloat(b))
      : result.sort();
  }, [data, source.column, paramType]);

  // Local filter text — only used while the combobox is open/focused
  const [filterText, setFilterText] = useState('');

  const filteredCollection = useMemo(() => {
    const lower = filterText.toLowerCase();
    const all = values ?? [];
    if (!lower) return createListCollection({ items: all.map(v => ({ value: v, label: v })) });
    const prefix: string[] = [];
    const rest: string[] = [];
    for (const v of all) {
      if (v.toLowerCase().startsWith(lower)) prefix.push(v);
      else if (v.toLowerCase().includes(lower)) rest.push(v);
    }
    return createListCollection({ items: [...prefix, ...rest].map(v => ({ value: v, label: v })) });
  }, [values, filterText]);

  // What to show in the input — formatted current committed value
  const defaultDisplayValue = currentValue !== undefined && currentValue !== null
    ? (paramType === 'number' ? formatNumStr(String(currentValue)) : String(currentValue))
    : '';

  // Controlled input display — we own it so Ark UI can't clear it on close.
  // SourceDropdownWidget is keyed on `value` from the parent, so this state
  // (and committedRef) automatically reinitializes whenever the committed value
  // changes externally (cancel, save, dashboard sync, etc.).
  const [inputDisplay, setInputDisplay] = useState(defaultDisplayValue);

  // Track last committed value so onOpenChange can restore the display on blur-without-select.
  const committedRef = useRef(defaultDisplayValue);

  const commit = (raw: string) => {
    committedRef.current = raw;
    setInputDisplay(raw);
    setFilterText('');
    const final: string | number = paramType === 'number' ? (parseFloat(raw) || 0) : raw;
    onChange(final);
  };

  return (
    <HStack gap={1}>
      {(error || (values !== null && values.length === 0 && !loading)) && (
        <Tooltip content={error ? 'Could not load suggestions' : 'No suggestions found'}>
          <Box color="orange.400" display="flex" alignItems="center">
            <LuTriangleAlert size={14} />
          </Box>
        </Tooltip>
      )}
      {loading && values === null && <Spinner size="xs" color="accent.teal" />}

      {/*
        inputValue is controlled so Ark UI cannot clear the input on close.
        onOpenChange restores the display to the last committed value when the user
        closes the dropdown without selecting (blur).
        External value changes (cancel, save) are handled by key={value} on the
        parent <SourceDropdownWidget>, which remounts the entire widget.
      */}
      <Combobox.Root
        collection={filteredCollection}
        inputValue={inputDisplay}
        onValueChange={(e) => {
          if (e.value[0] !== undefined) commit(e.value[0]);
        }}
        onInputValueChange={(details) => {
          setInputDisplay(details.inputValue);
          setFilterText(details.inputValue);
        }}
        onOpenChange={({ open }) => {
          if (!open) {
            setInputDisplay(committedRef.current);
            setFilterText('');
          }
        }}
        openOnClick
        inputBehavior="none"
        positioning={{ placement: 'bottom-start', gutter: 4 }}
        size="sm"
      >
        <Combobox.Control>
          <Combobox.Input
            placeholder={paramType === 'number' ? '0 or select…' : 'type or select…'}
            bg="bg.canvas"
            borderColor="border.muted"
            fontSize="sm"
            h={ROW_H}
            minW="120px"
            fontFamily={paramType === 'number' ? 'mono' : 'inherit'}
            _focus={{
              borderColor: 'accent.teal',
              boxShadow: '0 0 0 1px var(--chakra-colors-accent-teal)',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
                e.preventDefault();
                e.stopPropagation();
                const raw = e.currentTarget.value;
                commit(raw);
                if (onSubmit) {
                  const final: string | number = paramType === 'number'
                    ? (parseFloat(raw) || 0)
                    : raw;
                  onSubmit(paramName, final);
                }
              }
            }}
          />
        </Combobox.Control>
        <Portal>
          <Combobox.Positioner>
            <Combobox.Content minW="160px">
              {loading && values === null ? (
                <Combobox.Empty>Loading…</Combobox.Empty>
              ) : filteredCollection.items.length === 0 ? (
                <Combobox.Empty>No matches</Combobox.Empty>
              ) : (
                filteredCollection.items.map(item => (
                  <Combobox.Item key={item.value} item={item}>
                    <Combobox.ItemText>{item.label}</Combobox.ItemText>
                    <Combobox.ItemIndicator />
                  </Combobox.Item>
                ))
              )}
            </Combobox.Content>
          </Combobox.Positioner>
        </Portal>
      </Combobox.Root>
    </HStack>
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
        <IconButton
          aria-label="Configure source"
          title="Configure parameter source"
          variant="ghost"
          h={ROW_H}
          w={ROW_H}
          minW={ROW_H}
          color={isFromQuestion ? 'accent.teal' : 'fg.subtle'}
          _hover={{ color: 'accent.teal', bg: 'bg.emphasized' }}
        >
          <LuSettings2 style={{ width: 13, height: 13 }} />
        </IconButton>
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content
            width="280px"
            bg="bg.surface"
            p={0}
            overflow="visible"
            borderRadius="md"
            border="1px solid"
            borderColor="border.muted"
            boxShadow="lg"
          >
            <Popover.Body p={3} overflow="visible">
              <VStack gap={3} align="stretch">
                <Box>
                  <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1.5}>
                    Source
                  </Text>
                  <HStack gap={1}>
                    {([
                      { value: 'manual', label: 'Free input' },
                      { value: 'question', label: 'From question' },
                    ] as const).map((opt) => (
                      <Box
                        key={opt.value}
                        as="button"
                        px={2.5}
                        py={1}
                        borderRadius="sm"
                        border="1px solid"
                        borderColor={mode === opt.value ? 'accent.teal' : 'border.muted'}
                        bg={mode === opt.value ? 'accent.teal/10' : 'bg.muted'}
                        color={mode === opt.value ? 'accent.teal' : 'fg.default'}
                        fontSize="xs"
                        fontWeight="600"
                        fontFamily="mono"
                        cursor="pointer"
                        _hover={{
                          borderColor: 'accent.teal',
                          color: 'accent.teal',
                        }}
                        transition="all 0.1s"
                        onClick={() => handleModeChange(opt.value)}
                      >
                        {opt.label}
                      </Box>
                    ))}
                  </HStack>
                </Box>

                {mode === 'question' && (
                  <>
                    <Box>
                      <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1.5}>
                        Question
                      </Text>
                      <FileSearchSelect
                        files={questionList}
                        selectedId={sourceQuestionId}
                        onSelect={handleQuestionSelect}
                        placeholder="Search questions…"
                      />
                    </Box>

                    {sourceQuestionId && (
                      <Box>
                        <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1.5}>
                          Column
                          {parameter.type === 'number' && (
                            <Text as="span" fontSize="2xs" color="fg.subtle" ml={1}>(numeric only)</Text>
                          )}
                        </Text>
                        <MenuRoot positioning={{ placement: 'bottom-start' }}>
                          <MenuTrigger asChild>
                            <HStack
                              as="button"
                              w="full"
                              px={2.5}
                              py={1.5}
                              bg="bg.muted"
                              borderRadius="sm"
                              border="1px solid"
                              borderColor="border.muted"
                              cursor="pointer"
                              fontSize="xs"
                              fontFamily="mono"
                              _hover={{ borderColor: 'accent.teal' }}
                              justify="space-between"
                            >
                              <Text lineClamp={1} color={parameter.source?.column ? 'fg.default' : 'fg.subtle'}>
                                {loadingCols ? 'Loading…' : parameter.source?.column || '— select column —'}
                              </Text>
                              <LuChevronDown size={12} />
                            </HStack>
                          </MenuTrigger>
                          <Portal>
                            <MenuPositioner>
                              <MenuContent
                                minW="200px"
                                maxH="200px"
                                overflowY="auto"
                                bg="bg.surface"
                                borderColor="border.default"
                                shadow="lg"
                                p={1}
                              >
                                {filteredColumns.length === 0 ? (
                                  <Box px={3} py={2}>
                                    <Text fontSize="xs" color="fg.subtle">{loadingCols ? 'Loading…' : 'No columns found'}</Text>
                                  </Box>
                                ) : filteredColumns.map(c => (
                                  <MenuItem
                                    key={c.name}
                                    value={c.name}
                                    onClick={() => handleColumnSelect(c.name)}
                                    px={3}
                                    py={1.5}
                                    borderRadius="sm"
                                    _hover={{ bg: 'bg.muted' }}
                                    cursor="pointer"
                                  >
                                    <Text fontSize="xs" fontFamily="mono">{c.name}</Text>
                                  </MenuItem>
                                ))}
                              </MenuContent>
                            </MenuPositioner>
                          </Portal>
                        </MenuRoot>
                      </Box>
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
  value: string | number | null | undefined;
  onChange: (value: string | number | null) => void;
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

  const isNone = value === null;
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

        {/* None state indicator — replaces the input when param is explicitly None */}
        {isNone ? (
          <HStack
            bg="bg.muted"
            borderRadius="md"
            border="1px dashed"
            borderColor="border.muted"
            px={2}
            h={ROW_H}
            minW="100px"
          >
            <Text fontSize="xs" color="fg.subtle" fontStyle="italic">None</Text>
          </HStack>
        ) : (
        /* Input field — dropdown when source is configured, otherwise standard input */
        hasSource && parameter.type !== 'date' ? (
          <SourceDropdownWidget
            key={String(value ?? '')}
            source={parameter.source!}
            paramType={parameter.type as 'text' | 'number'}
            currentValue={value ?? undefined}
            paramName={parameter.name}
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
            aria-label={parameter.name}
          />
        )
        )}

        {/* X button — toggles None on/off; always visible (undefined and '' both look empty) */}
        {(
          <Tooltip content={isNone ? 'Clear — restore to empty' : 'Set to None (skip this filter)'}>
            <IconButton
              aria-label={isNone ? 'Clear None' : 'Set to None'}
              variant="ghost"
              onClick={() => onChange(isNone ? '' : null)}
              color="fg.subtle"
              h={ROW_H}
              w={ROW_H}
              minW={ROW_H}
              _hover={{ color: isNone ? 'fg' : 'accent.danger', bg: 'bg.emphasized' }}
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
