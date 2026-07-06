'use client';

// ─── Source Dropdown Widget ───────────────────────────────────────────────────
// Rendered in place of the text/number Input when parameter.source is set.

import React, { useState, useMemo } from 'react';
import { Input, HStack, Box, Spinner } from '@chakra-ui/react';
import { LuTriangleAlert } from 'react-icons/lu';
import { Tooltip } from '@/components/ui/tooltip';
import { QuestionContent } from '@/lib/types';
import type { QuestionParameterSource } from '@/lib/validation/atlas-schemas';
import { useFile, useQueryResult } from '@/lib/hooks/file-state-hooks';
import { ROW_H, formatNumStr } from './paramInputShared';

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
