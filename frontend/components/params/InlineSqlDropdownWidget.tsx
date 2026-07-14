'use client';

// ─── Inline SQL Dropdown Widget ──────────────────────────────────────────────
// Rendered when parameter.source.type === 'sql'. Executes the inline query and
// shows results as a combobox dropdown.

import React, { useState, useMemo, useRef } from 'react';
import { HStack, Box, Portal, Spinner, Combobox, createListCollection } from '@chakra-ui/react';
import { LuTriangleAlert } from 'react-icons/lu';
import { Tooltip } from '@/components/ui/tooltip';
import type { SqlParameterSource } from '@/lib/validation/atlas-schemas';
import { useQueryResult } from '@/lib/hooks/file-state-hooks';
import { ROW_H, formatNumStr } from './paramInputShared';

interface InlineSqlDropdownWidgetProps {
  source: SqlParameterSource;
  paramType: 'text' | 'number';
  currentValue: string | number | undefined;
  paramName: string;
  database?: string;
  onChange: (value: string | number) => void;
  onSubmit?: (paramName?: string, value?: string | number) => void;
}

export function InlineSqlDropdownWidget({ source, paramType, currentValue, paramName, database, onChange, onSubmit }: InlineSqlDropdownWidgetProps) {
  const { data, loading, error } = useQueryResult(
    source.query,
    {},
    database ?? '',
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
