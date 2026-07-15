'use client';

/**
 * FilterEditor — the semantic filter popover (dimension → operator → value).
 * Three entry points, one component:
 *  - add flow: no `initial`/`presetDimension` → starts at the dimension list
 *  - drop flow: `presetDimension` set (a dimension chip dropped on the
 *    Filters shelf) → dimension step skipped
 *  - edit flow: `initial` set (an existing filter chip clicked) → everything
 *    prefilled; Apply REPLACES the filter
 * The popover is controlled by the parent (open/onOpenChange) so the
 * drop-to-filter flow can open it without a click on the trigger.
 */

import React, { useState } from 'react';
import { VStack, HStack, Text, Button, Input, Box } from '@chakra-ui/react';
import { LuX } from 'react-icons/lu';
import { PickerPopover, PickerHeader, PickerList, PickerItem } from '../query-builder/PickerPopover';
import type { SemanticQueryFilter } from '@/lib/validation/atlas-schemas';

const OPERATORS: SemanticQueryFilter['operator'][] = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'ILIKE', 'IN', 'IS NULL', 'IS NOT NULL'];

const valueToText = (value: SemanticQueryFilter['value']): string =>
  Array.isArray(value) ? value.join(', ') : value == null ? '' : String(value);

interface FilterEditorProps {
  dimensions: string[];
  /** Existing filter to edit — prefills dimension/operator/value. */
  initial?: SemanticQueryFilter;
  /** Skip the dimension step in the add flow (drop-on-Filters-shelf). */
  presetDimension?: string;
  trigger: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (filter: SemanticQueryFilter) => void;
}

export function FilterEditor({ dimensions, initial, presetDimension, trigger, open, onOpenChange, onSubmit }: FilterEditorProps) {
  return (
    <PickerPopover
      open={open}
      onOpenChange={(details) => onOpenChange(details.open)}
      trigger={trigger}
      width="300px"
      padding={3}
    >
      {/* The form mounts fresh per open — its useState initializers pick up
          whatever preset/initial applies to THIS open (different chip clicked,
          different dimension dropped). */}
      {open && (
        <FilterForm
          dimensions={dimensions}
          initial={initial}
          presetDimension={presetDimension}
          onCancel={() => onOpenChange(false)}
          onSubmit={(filter) => { onSubmit(filter); onOpenChange(false); }}
        />
      )}
    </PickerPopover>
  );
}

function FilterForm({ dimensions, initial, presetDimension, onCancel, onSubmit }: {
  dimensions: string[];
  initial?: SemanticQueryFilter;
  presetDimension?: string;
  onCancel: () => void;
  onSubmit: (filter: SemanticQueryFilter) => void;
}) {
  const [dimension, setDimension] = useState(initial?.dimension ?? presetDimension ?? '');
  const [operator, setOperator] = useState<SemanticQueryFilter['operator']>(initial?.operator ?? '=');
  const [value, setValue] = useState(valueToText(initial?.value));

  const needsValue = operator !== 'IS NULL' && operator !== 'IS NOT NULL';

  const submit = () => {
    if (!dimension || (needsValue && !value.trim())) return;
    const parsed: SemanticQueryFilter['value'] = !needsValue ? undefined
      : operator === 'IN' ? value.split(',').map((v) => v.trim()).filter(Boolean)
      : value.trim() !== '' && !isNaN(Number(value)) ? Number(value)
      : value;
    onSubmit({ dimension, operator, ...(parsed !== undefined ? { value: parsed } : {}) });
  };

  return (
      <VStack gap={2} align="stretch">
        {!dimension ? (
          <>
            <PickerHeader>Filter dimension</PickerHeader>
            <PickerList maxH="220px" searchable searchPlaceholder="Search dimensions...">
              {(query: string) => dimensions
                .filter((d) => !query || d.toLowerCase().includes(query.toLowerCase()))
                .map((d) => (
                  <PickerItem key={d} aria-label={`Filter dimension ${d}`} onClick={() => setDimension(d)}>
                    {d}
                  </PickerItem>
                ))}
            </PickerList>
          </>
        ) : (
          <>
            <Text fontSize="xs" fontFamily="mono" fontWeight="600">{dimension}</Text>
            <HStack gap={1} flexWrap="wrap">
              {OPERATORS.map((op) => (
                <Button
                  key={op}
                  aria-label={`Semantic operator ${op}`}
                  size="2xs"
                  variant={operator === op ? 'solid' : 'outline'}
                  fontFamily="mono"
                  onClick={() => setOperator(op)}
                >
                  {op}
                </Button>
              ))}
            </HStack>
            {needsValue && (
              <Input
                aria-label="Semantic filter value"
                size="sm"
                fontFamily="mono"
                fontSize="xs"
                placeholder={operator === 'IN' ? 'a, b, c' : 'value'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                autoFocus
              />
            )}
            <HStack justify="flex-end" gap={2}>
              <Button size="2xs" variant="outline" onClick={onCancel}>Cancel</Button>
              <Button aria-label="Apply semantic filter" size="2xs" bg="accent.teal" color="white" onClick={submit}
                disabled={!dimension || (needsValue && !value.trim())}>
                Apply
              </Button>
            </HStack>
          </>
        )}
      </VStack>
  );
}

/** Compact human form of a filter for its shelf chip. */
export function filterChipText(f: SemanticQueryFilter): string {
  return f.operator === 'IS NULL' || f.operator === 'IS NOT NULL'
    ? `${f.dimension} ${f.operator}`
    : `${f.dimension} ${f.operator} ${Array.isArray(f.value) ? `(${f.value.join(', ')})` : String(f.value ?? '')}`;
}

/** Chip-with-remove used by every shelf. Kept here to share across shelves. */
export function ShelfChip({ label, onRemove, onClick, children }: {
  label: string; onRemove?: () => void; onClick?: () => void; children: React.ReactNode;
}) {
  return (
    <HStack
      aria-label={label}
      as={onClick ? 'button' : undefined}
      gap={1.5} px={2} py={1}
      bg="bg.muted" borderRadius="md" border="1px solid" borderColor="border.muted"
      userSelect="none"
      cursor={onClick ? 'pointer' : undefined}
      _hover={onClick ? { borderColor: 'accent.teal' } : undefined}
      onClick={onClick}
    >
      {children}
      {onRemove && (
        <RemoveButton chipLabel={label} onRemove={onRemove} />
      )}
    </HStack>
  );
}

function RemoveButton({ chipLabel, onRemove }: { chipLabel: string; onRemove: () => void }) {
  return (
    <Box
      as="button"
      aria-label={`Remove ${chipLabel.split(': ')[1]} from ${chipLabel.split(' chip')[0]}`}
      onClick={(e: React.MouseEvent) => { e.stopPropagation(); onRemove(); }}
      _hover={{ color: 'accent.danger' }}
      flexShrink={0}
      display="flex"
    >
      <LuX size={12} />
    </Box>
  );
}
