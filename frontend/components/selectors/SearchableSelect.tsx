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

import { Fragment, useMemo, useRef, useState } from 'react';
import { Badge, Box, HStack, Icon, Input, Popover, Portal, Text, VStack } from '@chakra-ui/react';
import { LuCheck, LuChevronDown, LuSearch } from 'react-icons/lu';
import type { SelectorOption } from './GenericSelector';

/** SelectorOption plus an optional trailing badge (e.g. "recommended"). */
export interface SearchableOption extends SelectorOption {
  badge?: string;
  /** Optional visual section label for grouped option lists. */
  group?: string;
  /** Visible but unavailable option, for capabilities that are not selectable yet. */
  disabled?: boolean;
  /** Optional when-to-use line rendered UNDER the label (wraps up to two
   *  lines) — unlike `subtitle`, which sits inline beside it. */
  description?: string;
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
  // Two-line descriptions need more room than plain label rows.
  const hasDescriptions = options.some(o => o.description);
  const selected = new Set(selectedValues);

  const pick = (value: string) => {
    if (options.find(option => option.value === value)?.disabled) return;
    onPick(value);
    if (closeOnPick) setOpen(false);
  };

  // NOT `autoFocus`: the portal'd popover sits at the document origin for a
  // frame before floating-ui positions it, and autoFocus (which can't opt out
  // of scroll-into-view) scrolls the page there — opening a picker near the
  // bottom of a long page jumped the page to the top. Instead the popover
  // machine focuses this element itself, after positioning and with
  // { preventScroll: true } (see zag-js popover `initialFocusEl`).
  const searchInputRef = useRef<HTMLInputElement | null>(null);

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
      initialFocusEl={() => searchInputRef.current}
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
            minW={hasDescriptions ? '340px' : '260px'}
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
                ref={searchInputRef}
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
                      aria-disabled={option.disabled || undefined}
                      aria-label={option.label}
                      cursor={option.disabled ? 'not-allowed' : 'pointer'}
                      borderRadius="sm"
                      px={2}
                      py={1.5}
                      bg={index === highlight && !option.disabled ? 'bg.muted' : 'transparent'}
                      opacity={option.disabled ? 0.6 : 1}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => {
                        if (!option.disabled) pick(option.value);
                      }}
                    >
                      <HStack gap={s.gap} justify="space-between" align="flex-start">
                        <HStack gap={s.gap} minW={0} flex={1} align="flex-start">
                          {option.icon && (
                            <Icon as={option.icon} boxSize={s.iconSize} color={isSelected ? 'fg' : 'fg.muted'} flexShrink={0} mt="1px" />
                          )}
                          <Box minW={0} flex={1}>
                            <HStack gap={s.gap} minW={0}>
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
                            {option.description && (
                              <Text fontSize="2xs" color="fg.muted" lineHeight="1.5" mt="1px" lineClamp={2}>
                                {option.description}
                              </Text>
                            )}
                          </Box>
                        </HStack>
                        <HStack gap={1.5} flexShrink={0}>
                          {option.badge && (
                            <Badge
                              size="xs"
                              colorPalette={option.disabled ? 'gray' : 'teal'}
                              aria-label={`${option.label} ${option.badge}`}
                            >
                              {option.badge}
                            </Badge>
                          )}
                          {isSelected && !option.disabled && (
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
