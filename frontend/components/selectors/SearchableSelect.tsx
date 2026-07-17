'use client';

/**
 * SearchableSelect / SearchableMultiSelect — the searchable sibling of
 * `GenericSelector` (same visual language: bordered trigger with label +
 * chevron, portal popover with icon/subtitle option rows) for lists long
 * enough to need type-to-filter, which Menu-based GenericSelector can't do.
 *
 * Single-select closes on pick; multi-select toggles membership and stays
 * open (trigger shows a count summary). Keyboard: type to filter, ArrowUp /
 * ArrowDown to move the highlight, Enter to pick, Escape to close.
 *
 * a11y contract (the repo's UI-test locator): the trigger carries `label`
 * as its aria-label, the search input carries `<label> search`, and every
 * option row carries its own label as aria-label.
 */

import { Fragment, useMemo, useState } from 'react';
import { Badge, Box, HStack, Icon, Input, Popover, Portal, Text, VStack } from '@chakra-ui/react';
import { LuCheck, LuChevronDown, LuSearch } from 'react-icons/lu';
import type { SelectorOption } from './GenericSelector';

/** SelectorOption plus an optional trailing badge (e.g. "recommended"). */
export interface SearchableOption extends SelectorOption {
  badge?: string;
  /** Optional visual section label for grouped option lists. */
  group?: string;
}

interface SearchableSelectBaseProps {
  options: SearchableOption[];
  placeholder?: string;
  emptyMessage?: string;
  size?: 'sm' | 'md';
  /** aria-label for the trigger (also prefixes the search input's label). */
  label?: string;
  disabled?: boolean;
  /** Optional typography override for the trigger and portaled menu. */
  fontFamily?: string;
  /** Layer override for selectors nested inside another popover. */
  positionerZIndex?: number;
}

export interface SearchableSelectProps extends SearchableSelectBaseProps {
  value: string;
  onChange: (value: string) => void;
}

export interface SearchableMultiSelectProps extends SearchableSelectBaseProps {
  values: string[];
  onChange: (values: string[]) => void;
  /** Trigger summary for the current selection; default: "N selected", placeholder when empty. */
  summary?: (values: string[]) => string;
}

const SIZE_STYLES = {
  sm: { px: 2, py: 1.5, iconSize: 3.5, fontSize: 'xs', gap: 1.5 },
  md: { px: 3, py: 2, iconSize: 4, fontSize: 'sm', gap: 2 },
} as const;

function matches(option: SearchableOption, query: string): boolean {
  const q = query.toLowerCase();
  return [option.label, option.subtitle ?? '', option.value].some(s => s.toLowerCase().includes(q));
}

/** Shared trigger + popover; single/multi differ only in trigger text and pick behavior. */
function SearchablePicker({
  options, placeholder = 'Select...', emptyMessage = 'No options available',
  size = 'sm', label, disabled, fontFamily, positionerZIndex = 2000,
  selectedValues, triggerText, triggerMuted, onPick, closeOnPick,
}: SearchableSelectBaseProps & {
  selectedValues: string[];
  triggerText: string;
  triggerMuted: boolean;
  onPick: (value: string) => void;
  closeOnPick: boolean;
}) {
  const s = SIZE_STYLES[size];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  const filtered = useMemo(
    () => (query ? options.filter(o => matches(o, query)) : options),
    [options, query],
  );
  const selected = new Set(selectedValues);

  const pick = (value: string) => {
    onPick(value);
    if (closeOnPick) setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = filtered[Math.min(highlight, filtered.length - 1)];
      if (hit) pick(hit.value);
    }
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(d) => { setOpen(d.open); setQuery(''); setHighlight(0); }}
      positioning={{ gutter: 4 }}
      lazyMount
      unmountOnExit
    >
      <Popover.Trigger
        disabled={disabled}
        w="100%"
        textAlign="left"
        px={s.px}
        py={s.py}
        borderRadius="md"
        border="1px solid"
        borderColor="border.default"
        bg="bg.surface"
        cursor={disabled ? 'not-allowed' : 'pointer'}
        opacity={disabled ? 0.5 : 1}
        transition="all 0.2s"
        _hover={disabled ? undefined : { bg: 'bg.muted' }}
        _focusVisible={{ outline: '2px solid', outlineColor: 'accent.teal', outlineOffset: '1px' }}
        aria-label={label}
        fontFamily={fontFamily}
      >
        <HStack gap={s.gap} justify="space-between">
          <Text
            fontSize={s.fontSize}
            fontWeight={triggerMuted ? '400' : '500'}
            color={triggerMuted ? 'fg.muted' : undefined}
            whiteSpace="nowrap"
            overflow="hidden"
            textOverflow="ellipsis"
            minW={0}
            flex={1}
          >
            {triggerText || placeholder}
          </Text>
          <Icon
            as={LuChevronDown}
            boxSize={s.iconSize}
            color="fg.subtle"
            flexShrink={0}
            transition="transform 0.15s ease"
            transform={open ? 'rotate(180deg)' : undefined}
          />
        </HStack>
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner zIndex={positionerZIndex}>
          <Popover.Content
            minW="260px"
            maxW="400px"
            bg="bg.surface"
            borderColor="border.default"
            shadow="lg"
            borderRadius="md"
            p={1.5}
            fontFamily={fontFamily}
          >
            <HStack
              gap={2}
              px={2}
              mb={1.5}
              bg="bg.subtle"
              border="1px solid"
              borderColor="border.default"
              borderRadius="md"
              h="30px"
              _focusWithin={{ borderColor: 'accent.teal' }}
              transition="border-color 0.2s"
            >
              <Box color="fg.muted" flexShrink={0}>
                <LuSearch size={13} />
              </Box>
              <Input
                size="xs"
                placeholder="Search…"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
                onKeyDown={onKeyDown}
                autoFocus
                bg="transparent"
                border="none"
                fontSize="xs"
                fontFamily={fontFamily}
                px={0}
                h="auto"
                _focus={{ outline: 'none', boxShadow: 'none' }}
                aria-label={label ? `${label} search` : 'Search options'}
              />
            </HStack>
            <VStack gap={0.5} align="stretch" maxH="260px" overflowY="auto" role="listbox">
              {filtered.length === 0 ? (
                <Text fontSize="xs" color="fg.muted" px={2} py={2} textAlign="center">
                  {options.length === 0 ? emptyMessage : 'No matches'}
                </Text>
              ) : (
                filtered.map((option, index) => {
                  const isSelected = selected.has(option.value);
                  const showGroup = !!option.group && (index === 0 || filtered[index - 1]?.group !== option.group);
                  return (
                    <Fragment key={option.value}>
                      {showGroup && (
                        <Text
                          fontSize="2xs"
                          fontWeight="600"
                          color="fg.subtle"
                          textTransform="uppercase"
                          letterSpacing="wide"
                          px={2}
                          pt={index === 0 ? 1 : 2}
                          pb={0.5}
                        >
                          {option.group}
                        </Text>
                      )}
                    <Box
                      role="option"
                      aria-selected={isSelected}
                      aria-label={option.label}
                      cursor="pointer"
                      borderRadius="sm"
                      px={2}
                      py={1.5}
                      bg={index === highlight ? 'bg.muted' : 'transparent'}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => pick(option.value)}
                    >
                      <HStack gap={s.gap} justify="space-between">
                        <HStack gap={s.gap} minW={0} flex={1}>
                          {option.icon && (
                            <Icon as={option.icon} boxSize={s.iconSize} color={isSelected ? 'fg' : 'fg.muted'} flexShrink={0} />
                          )}
                          <Text
                            fontSize="xs"
                            fontWeight={isSelected ? '600' : '400'}
                            whiteSpace="nowrap"
                            overflow="hidden"
                            textOverflow="ellipsis"
                          >
                            {option.label}
                          </Text>
                          {option.subtitle && (
                            <Text fontSize="2xs" color="fg.muted" fontFamily="mono" whiteSpace="nowrap">
                              {option.subtitle}
                            </Text>
                          )}
                        </HStack>
                        <HStack gap={1.5} flexShrink={0}>
                          {option.badge && (
                            <Badge size="xs" colorPalette="teal" aria-label={`${option.label} ${option.badge}`}>
                              {option.badge}
                            </Badge>
                          )}
                          {isSelected && (
                            <Icon as={LuCheck} boxSize={3.5} color="accent.teal" flexShrink={0} strokeWidth={2.5} />
                          )}
                        </HStack>
                      </HStack>
                    </Box>
                    </Fragment>
                  );
                })
              )}
            </VStack>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}

export function SearchableSelect({ value, onChange, ...rest }: SearchableSelectProps) {
  const selected = rest.options.find(o => o.value === value);
  return (
    <SearchablePicker
      {...rest}
      selectedValues={value ? [value] : []}
      triggerText={selected?.label ?? ''}
      triggerMuted={!selected}
      onPick={onChange}
      closeOnPick
    />
  );
}

export function SearchableMultiSelect({ values, onChange, summary, ...rest }: SearchableMultiSelectProps) {
  const triggerText = values.length === 0 ? '' : (summary ? summary(values) : `${values.length} selected`);
  return (
    <SearchablePicker
      {...rest}
      selectedValues={values}
      triggerText={triggerText}
      triggerMuted={values.length === 0}
      onPick={(value) => {
        onChange(values.includes(value) ? values.filter(v => v !== value) : [...values, value]);
      }}
      closeOnPick={false}
    />
  );
}
