'use client';

// ─── Source Config Popover ────────────────────────────────────────────────────
// Settings gear that opens a popover to configure parameter.source.

import React, { useState, useMemo, useEffect } from 'react';
import {
  Input, HStack, Text, MenuRoot, MenuTrigger, MenuContent, MenuItem,
  Portal, MenuPositioner, Box, IconButton, VStack, Popover, Button,
} from '@chakra-ui/react';
import { LuChevronDown, LuSettings2 } from 'react-icons/lu';
import { QuestionParameter } from '@/lib/types';
import type { SqlParameterSource } from '@/lib/validation/atlas-schemas';
import { getTypeColor, getTypeIcon } from '@/lib/sql/param-type-display';
import { generateLabel } from '@/lib/sql/sql-params';
import { useFilesByCriteria } from '@/lib/hooks/file-state-hooks';
import FileSearchSelect from '../shared/FileSearchSelect';
import { ROW_H } from './paramInputShared';

// Numeric SQL type patterns (sqlglot output)
const NUMERIC_TYPE_RE = /^(int|integer|bigint|smallint|tinyint|float|double|decimal|numeric|number|real|int2|int4|int8|uint|ubigint|float4|float8|hugeint)/i;

function isNumericType(type: string): boolean {
  return NUMERIC_TYPE_RE.test(type.trim());
}

interface SourceConfigPopoverProps {
  parameter: QuestionParameter;
  onParameterChange: (updated: QuestionParameter) => void;
  onTypeChange?: (type: 'text' | 'number' | 'date') => void;
  disableTypeChange?: boolean;
}

export function SourceConfigPopover({ parameter, onParameterChange, onTypeChange, disableTypeChange }: SourceConfigPopoverProps) {
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
    // autoFocus={false}: zag re-runs the popover's initial-focus on controlled re-renders, so
    // WITHOUT this, every keystroke in the Display-name input (which lifts state to the parent
    // and re-renders this subtree) yanks focus back to the content div — typing loses every
    // character after the first.
    <Popover.Root open={open} onOpenChange={(d) => setOpen(d.open)} positioning={{ placement: 'bottom-end' }} autoFocus={false}>
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
