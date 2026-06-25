'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Input, HStack, Text, MenuRoot, MenuTrigger, MenuContent, MenuItem,
  Portal, MenuPositioner, Box, IconButton, VStack, Popover, Spinner, Button,
  Combobox, createListCollection,
} from '@chakra-ui/react';
import { LuChevronDown, LuSettings2, LuTriangleAlert, LuBan } from 'react-icons/lu';
import { Tooltip } from '@/components/ui/tooltip';
import { QuestionParameter, QuestionContent } from '@/lib/types';
import type { QuestionParameterSource, SqlParameterSource } from '@/lib/validation/atlas-schemas';
import { getTypeColor, getTypeIcon } from '@/lib/sql/param-type-display';
import { getParameterDisplayName, generateLabel } from '@/lib/sql/sql-params';
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
  source: QuestionParameterSource;
  paramType: 'text' | 'number';
  currentValue: string | number | undefined;
  paramName: string;
  onChange: (value: string | number) => void;
  onSubmit?: (paramName?: string, value?: string | number) => void;
  /** Agent-supplied CSS for the input (story `<Param style={{…}}>`) — literal CSS, wins over defaults. */
  inputStyle?: React.CSSProperties;
}

// Format a number string to max 2 decimal places, removing trailing zeros
function formatNumStr(v: string): string {
  const n = parseFloat(v);
  if (isNaN(n)) return v;
  return String(parseFloat(n.toFixed(2)));
}

export function SourceDropdownWidget({ source, paramType, currentValue, paramName, onChange, onSubmit, inputStyle }: SourceDropdownWidgetProps) {
  const augmented = useFile(source.id);
  const content = augmented?.fileState.content as QuestionContent | undefined | null;

  const { data, loading, error } = useQueryResult(
    content?.query ?? '',
    (content?.parameterValues ?? {}) as Record<string, any>,
    content?.connection_name ?? '',
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
      if (v != null) {
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

  // What to show in the input — formatted current committed value
  const defaultDisplayValue = currentValue != null
    ? (paramType === 'number' ? formatNumStr(String(currentValue)) : String(currentValue))
    : '';

  // Controlled input display, owned locally so typing drives it directly. We do NOT key/remount
  // on value changes (that lost focus mid-type) and we do NOT resync from the prop in an effect:
  // for a story `<Param>`, the value only ever changes by the reader typing into THIS widget, so
  // the local state is always the source of truth. A fresh mount (story reload) re-seeds it from
  // the committed value via useState's initializer.
  const [inputDisplay, setInputDisplay] = useState(defaultDisplayValue);

  const commit = (raw: string) => {
    setInputDisplay(raw);
    const final: string | number = paramType === 'number' ? (parseFloat(raw) || 0) : raw;
    onChange(final);
  };

  const listId = `param-src-${source.id}-${source.column}`;

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
        Native <datalist> autocomplete — NOT a floating popover. This control renders inside the
        story's SHADOW ROOT (StoryParamControl portals it there). A floating dropdown (Ark UI /
        floating-ui) cannot measure its anchor across the shadow boundary, so its menu — and its
        "No matches" empty state — rendered detached in a corner of the window. The browser
        positions a <datalist> itself, correctly, in any context (shadow root included), with zero
        positioning code. Explicit LIGHT colors because Chakra surface/fg tokens resolve against the
        host app's color mode across the shadow boundary (a dark-app token paints this black on a
        light story). `role=combobox` matches the input-with-list ARIA contract.
      */}
      <Input
        list={listId}
        role="combobox"
        aria-label={`param ${paramName}`}
        placeholder={paramType === 'number' ? '0 or select…' : 'type or select…'}
        value={inputDisplay}
        bg="white"
        color="gray.900"
        borderColor="gray.300"
        _placeholder={{ color: 'gray.500' }}
        fontSize="sm"
        h={ROW_H}
        minW="120px"
        fontFamily={paramType === 'number' ? 'mono' : 'inherit'}
        _focus={{
          borderColor: 'accent.teal',
          boxShadow: '0 0 0 1px var(--chakra-colors-accent-teal)',
        }}
        style={inputStyle}
        onChange={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
            e.preventDefault();
            e.stopPropagation();
            const raw = e.currentTarget.value;
            commit(raw);
            if (onSubmit) {
              const final: string | number = paramType === 'number' ? (parseFloat(raw) || 0) : raw;
              onSubmit(paramName, final);
            }
          }
        }}
      />
      <datalist id={listId}>
        {(values ?? []).map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
    </HStack>
  );
}

// ─── Inline SQL Dropdown Widget ──────────────────────────────────────────────
// Rendered when parameter.source.type === 'sql'. Executes the inline query and
// shows results as a combobox dropdown.

interface InlineSqlDropdownWidgetProps {
  source: SqlParameterSource;
  paramType: 'text' | 'number';
  currentValue: string | number | undefined;
  paramName: string;
  database?: string;
  onChange: (value: string | number) => void;
  onSubmit?: (paramName?: string, value?: string | number) => void;
}

function InlineSqlDropdownWidget({ source, paramType, currentValue, paramName, database, onChange, onSubmit }: InlineSqlDropdownWidgetProps) {
  const { data, loading, error } = useQueryResult(
    source.query,
    {},
    database ?? '',
    undefined,
    { skip: !source.query }
  );

  // Extract distinct values from the first column
  const values = useMemo<string[] | null>(() => {
    if (!data?.rows || !data?.columns?.length) return null;
    const firstCol = data.columns[0];
    const col = typeof firstCol === 'string' ? firstCol : firstCol.name;
    const seen = new Set<string>();
    const result: string[] = [];
    for (const row of data.rows) {
      const v = row[col];
      if (v != null) {
        const str = paramType === 'number' ? formatNumStr(String(v)) : String(v);
        if (!seen.has(str)) {
          seen.add(str);
          result.push(str);
        }
      }
    }
    return paramType === 'number'
      ? result.sort((a, b) => parseFloat(a) - parseFloat(b))
      : result.sort();
  }, [data, paramType]);

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

  const defaultDisplayValue = currentValue != null
    ? (paramType === 'number' ? formatNumStr(String(currentValue)) : String(currentValue))
    : '';

  const [inputDisplay, setInputDisplay] = useState(defaultDisplayValue);
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
            aria-label={`param ${paramName}`}
            placeholder={paramType === 'number' ? '0 or select…' : 'type or select…'}
            bg="transparent"
            border="none"
            fontSize="xs"
            h={ROW_H}
            minW="100px"
            fontFamily="mono"
            _focus={{ outline: 'none', boxShadow: 'none' }}
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
  onTypeChange?: (type: 'text' | 'number' | 'date') => void;
  disableTypeChange?: boolean;
}

function SourceConfigPopover({ parameter, onParameterChange, onTypeChange, disableTypeChange }: SourceConfigPopoverProps) {
  const [open, setOpen] = useState(false);
  const [columns, setColumns] = useState<{ name: string; type: string }[]>([]);
  const [loadingCols, setLoadingCols] = useState(false);

  // Local mode state tracks the toggle, even before config is complete.
  const isFromQuestion = parameter.source?.type === 'question';
  const isFromSql = parameter.source?.type === 'sql';
  const [mode, setMode] = useState<'manual' | 'question' | 'sql'>(
    isFromSql ? 'sql' : isFromQuestion ? 'question' : 'manual'
  );
  const [sqlQuery, setSqlQuery] = useState(isFromSql ? (parameter.source as SqlParameterSource).query : '');

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

  // Local draft state for question source (not committed until Apply)
  const [draftQuestionId, setDraftQuestionId] = useState<number | null>(sourceQuestionId);
  const [draftColumn, setDraftColumn] = useState(parameter.source?.type === 'question' ? parameter.source.column : '');

  const handleModeChange = (newMode: 'manual' | 'question' | 'sql') => {
    setMode(newMode);
    if (newMode === 'manual') {
      onParameterChange({ ...parameter, source: null });
      setColumns([]);
      setSqlQuery('');
      setDraftQuestionId(null);
      setDraftColumn('');
    } else if (newMode === 'sql') {
      setColumns([]);
      setDraftQuestionId(null);
      setDraftColumn('');
    } else if (newMode === 'question') {
      setSqlQuery('');
    }
  };

  const handleQuestionSelect = (id: number) => {
    setDraftQuestionId(id);
    setDraftColumn('');
    fetchColumns(id);
  };

  const handleColumnSelect = (column: string) => {
    setDraftColumn(column);
  };

  // Can we apply?
  const canApply =
    (mode === 'question' && !!draftQuestionId && !!draftColumn) ||
    (mode === 'sql' && !!sqlQuery.trim());

  // Check if current config differs from saved
  const isDirty = (() => {
    if (mode === 'manual') return false; // manual applies immediately
    if (mode === 'question') {
      if (parameter.source?.type !== 'question') return !!draftQuestionId && !!draftColumn;
      return draftQuestionId !== parameter.source.id || draftColumn !== parameter.source.column;
    }
    if (mode === 'sql') {
      if (parameter.source?.type !== 'sql') return !!sqlQuery.trim();
      return sqlQuery.trim() !== parameter.source.query;
    }
    return false;
  })();

  const handleApply = () => {
    if (mode === 'question' && draftQuestionId && draftColumn) {
      onParameterChange({ ...parameter, source: { type: 'question', id: draftQuestionId, column: draftColumn } });
    } else if (mode === 'sql' && sqlQuery.trim()) {
      onParameterChange({ ...parameter, source: { type: 'sql', query: sqlQuery.trim() } });
    }
    setOpen(false);
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
          color={isFromQuestion || isFromSql ? 'accent.teal' : 'fg.subtle'}
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
                {/* Display name */}
                <Box>
                  <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1.5}>
                    Display name
                  </Text>
                  <Input
                    aria-label={`Display name for ${parameter.name}`}
                    size="sm"
                    h={ROW_H}
                    fontSize="xs"
                    bg="bg.muted"
                    borderColor="border.muted"
                    placeholder={generateLabel(parameter.name)}
                    value={parameter.label ?? ''}
                    onChange={(e) => onParameterChange({ ...parameter, label: e.target.value || null })}
                    _focus={{ borderColor: 'accent.teal', boxShadow: '0 0 0 1px var(--chakra-colors-accent-teal)' }}
                  />
                </Box>

                {/* Type selector */}
                {onTypeChange && !disableTypeChange && (
                  <Box>
                    <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1.5}>
                      Type
                    </Text>
                    <HStack gap={1}>
                      {([
                        { value: 'text', label: 'Text' },
                        { value: 'number', label: 'Number' },
                        { value: 'date', label: 'Date' },
                      ] as const).map((opt) => (
                        <Box
                          key={opt.value}
                          as="button"
                          px={2.5}
                          py={1}
                          borderRadius="sm"
                          border="1px solid"
                          borderColor={parameter.type === opt.value ? getTypeColor(opt.value) : 'border.muted'}
                          bg={parameter.type === opt.value ? getTypeColor(opt.value) + '/10' : 'bg.muted'}
                          color={parameter.type === opt.value ? getTypeColor(opt.value) : 'fg.default'}
                          fontSize="xs"
                          fontWeight="600"
                          fontFamily="mono"
                          cursor="pointer"
                          _hover={{
                            borderColor: getTypeColor(opt.value),
                            color: getTypeColor(opt.value),
                          }}
                          transition="all 0.1s"
                          onClick={() => onTypeChange(opt.value)}
                        >
                          <HStack gap={1}>
                            {React.createElement(getTypeIcon(opt.value), { size: 14 })}
                            <span>{opt.label}</span>
                          </HStack>
                        </Box>
                      ))}
                    </HStack>
                  </Box>
                )}

                <Box>
                  <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1.5}>
                    Source
                  </Text>
                  <HStack gap={1} flexWrap="wrap">
                    {([
                      { value: 'manual', label: 'Free input' },
                      { value: 'question', label: 'Saved question' },
                      { value: 'sql', label: 'Inline SQL' },
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

                {mode === 'sql' && (
                  <Box>
                    <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1.5}>
                      Query
                    </Text>
                    <textarea
                      style={{
                        width: '100%',
                        minHeight: '60px',
                        padding: '6px 10px',
                        background: 'var(--chakra-colors-bg-muted)',
                        borderRadius: '4px',
                        border: '1px solid var(--chakra-colors-border-muted)',
                        fontSize: '12px',
                        fontFamily: 'var(--chakra-fonts-mono)',
                        color: 'var(--chakra-colors-fg-default)',
                        resize: 'vertical',
                        outline: 'none',
                      }}
                      onFocus={(e) => { e.target.style.borderColor = 'var(--chakra-colors-accent-teal)'; }}
                      onBlur={(e) => { e.target.style.borderColor = 'var(--chakra-colors-border-muted)'; }}
                      placeholder="SELECT DISTINCT year FROM sales"
                      value={sqlQuery}
                      onChange={(e) => setSqlQuery(e.target.value)}
                    />
                  </Box>
                )}

                {mode === 'question' && (
                  <>
                    <Box>
                      <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={1.5}>
                        Question
                      </Text>
                      <FileSearchSelect
                        files={questionList}
                        selectedId={draftQuestionId}
                        onSelect={handleQuestionSelect}
                        placeholder="Search questions…"
                      />
                    </Box>

                    {draftQuestionId && (
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
                              <Text lineClamp={1} color={draftColumn ? 'fg.default' : 'fg.subtle'}>
                                {loadingCols ? 'Loading…' : draftColumn || '— select column —'}
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
                {/* Apply button */}
                {(mode === 'question' || mode === 'sql') && (
                  <Button
                    size="xs"
                    bg="accent.teal"
                    color="white"
                    fontFamily="mono"
                    fontWeight="600"
                    fontSize="xs"
                    w="full"
                    _hover={{ opacity: 0.9 }}
                    disabled={!canApply || !isDirty}
                    onClick={handleApply}
                  >
                    Apply
                  </Button>
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
