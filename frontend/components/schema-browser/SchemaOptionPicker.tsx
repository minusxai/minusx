'use client';

/**
 * SchemaOptionPicker — the shared searchable dropdown for schema-flavored
 * choices (tables, columns, aggregations, metric names…), styled like the
 * mention submenu: mono rows, hover highlight, the option's type/meta on the
 * right in the shared type color. The nicer replacement for the native
 * <select>s that schema pickers used to be.
 *
 * The panel renders through a PORTAL with fixed positioning (flipping upward
 * near the viewport bottom): ancestors routinely clip (`overflow: hidden`
 * section containers), and an absolutely-positioned panel would be cut off —
 * the portal escapes every clipping context. It closes on outside click,
 * Escape, scroll and resize.
 *
 * Purely presentational + local open/search state — the caller owns the value
 * and the option list (resolve columns with `useTableColumns`/`getTableColumns`
 * so bounded, names-only schemas still populate).
 *
 * Aria contract (tests query by label only): the trigger carries `label`, each
 * row `${label}-option-${value}`, the search input `${label}-search`, and the
 * no-options row `${label}-empty`.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, HStack, Text, Icon, Input } from '@chakra-ui/react';
import { LuChevronDown } from 'react-icons/lu';
import { getTypeColor } from './type-color';

export interface SchemaPickerOption {
  value: string;
  label: string;
  /** Right-aligned annotation (usually the SQL type). */
  meta?: string;
  /** Overrides the default `getTypeColor(meta)` accent. */
  metaColor?: string;
}

interface SchemaOptionPickerProps {
  /** aria-label of the trigger; rows derive theirs from it. */
  label: string;
  value: string;
  options: SchemaPickerOption[];
  onSelect: (value: string) => void;
  placeholder?: string;
  /** When set, a `value: ''` choice with this label is offered first. */
  emptyOption?: string;
  /** Shown inside the panel when there are no options at all. */
  emptyMessage?: string;
  /** Trigger width bounds (defaults suit inline rows). */
  minW?: string;
  maxW?: string;
}

/** Search only earns its row once scanning the list stops being instant. */
const SEARCH_THRESHOLD = 8;
/** Panel max height + margin — used to decide when to flip upward. */
const PANEL_CLEARANCE = 340;

interface PanelPos { top: number; left: number; up: boolean }

export default function SchemaOptionPicker({
  label, value, options, onSelect, placeholder = 'pick…', emptyOption, emptyMessage,
  minW = '110px', maxW = '240px',
}: SchemaOptionPickerProps) {
  const [pos, setPos] = useState<PanelPos | null>(null); // non-null ⇔ open
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const open = pos !== null;

  const selected = options.find((o) => o.value === value);
  // A stored value missing from the options stays visible (never silently
  // blanked), exactly like the old selects kept a stale <option>.
  const display = selected?.label ?? (value || '');
  const showSearch = options.length > SEARCH_THRESHOLD;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const close = () => { setPos(null); setQuery(''); };

  const openPanel = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) { setPos({ top: 0, left: 0, up: false }); return; }
    const up = r.bottom + PANEL_CLEARANCE > window.innerHeight && r.top > PANEL_CLEARANCE;
    setPos({ top: up ? r.top - 4 : r.bottom + 4, left: r.left, up });
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !panelRef.current?.contains(t)) close();
    };
    // The trigger's rect goes stale the moment anything scrolls or resizes —
    // close instead of chasing it. Scrolling INSIDE the panel stays open.
    const onScroll = (e: Event) => {
      if (!panelRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    searchRef.current?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (v: string) => { onSelect(v); close(); };

  const optionRow = (o: SchemaPickerOption, muted = false) => (
    <HStack
      key={o.value || ' empty'}
      as="button"
      aria-label={`${label}-option-${o.value}`}
      onClick={() => pick(o.value)}
      px={2.5} py={1.5} gap={2} justify="space-between" w="100%" textAlign="left"
      cursor="pointer"
      bg={o.value === value ? 'bg.muted' : 'transparent'}
      _hover={{ bg: 'bg.muted' }}
      borderBottom="1px solid" borderColor="border.muted"
      _last={{ borderBottom: 'none' }}
    >
      <Text fontSize="xs" fontFamily="mono" fontWeight={o.value === value ? '700' : '500'}
        color={muted ? 'fg.subtle' : 'fg.default'} truncate>
        {o.label}
      </Text>
      {o.meta && (
        <Text fontSize="10px" fontWeight="600" fontFamily="mono" flexShrink={0}
          color={o.metaColor ?? getTypeColor(o.meta)}>
          {o.meta}
        </Text>
      )}
    </HStack>
  );

  const panel = pos && (
    <Box
      ref={panelRef}
      position="fixed"
      top={`${pos.top}px`}
      left={`${pos.left}px`}
      transform={pos.up ? 'translateY(-100%)' : undefined}
      zIndex={1400}
      minW="220px" maxW="320px" bg="bg.panel"
      border="1px solid" borderColor="border.default" borderRadius="lg" boxShadow="lg"
      overflow="hidden"
      onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Escape') close(); }}
    >
      {showSearch && (
        <Box px={2} py={1.5} borderBottom="1px solid" borderColor="border.muted" bg="bg.subtle">
          <Input
            ref={searchRef}
            aria-label={`${label}-search`}
            size="2xs" fontFamily="mono"
            placeholder="search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filtered.length > 0) pick(filtered[0].value);
            }}
          />
        </Box>
      )}
      <Box maxH="280px" overflowY="auto">
        {options.length === 0 ? (
          <Text aria-label={`${label}-empty`} px={2.5} py={2} fontSize="xs" color="fg.subtle">
            {emptyMessage ?? 'no options'}
          </Text>
        ) : (
          <>
            {emptyOption && !query && optionRow({ value: '', label: emptyOption }, true)}
            {filtered.map((o) => optionRow(o))}
          </>
        )}
      </Box>
    </Box>
  );

  return (
    <Box display="inline-block"
      onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Escape') close(); }}>
      <HStack
        ref={triggerRef}
        as="button"
        aria-label={label}
        onClick={() => (open ? close() : openPanel())}
        h="26px" px={2} gap={1.5} minW={minW} maxW={maxW}
        border="1px solid" borderColor="border.muted" borderRadius="md"
        bg="bg.canvas" cursor="pointer"
        _hover={{ borderColor: 'accent.teal/40' }}
      >
        <Text fontSize="xs" fontFamily="mono" color={display ? 'fg.default' : 'fg.subtle'} truncate>
          {display || placeholder}
        </Text>
        <Icon as={LuChevronDown} boxSize={3} color="fg.subtle" flexShrink={0} ml="auto" />
      </HStack>
      {panel && createPortal(panel, document.body)}
    </Box>
  );
}
