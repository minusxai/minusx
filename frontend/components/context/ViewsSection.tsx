'use client';

/**
 * ViewsSection — the `_views` area of the whitelist UI.
 *
 * Views are curated SQL that behave like tables, so they're whitelisted like
 * tables: each view has a checkbox, and expanding it reveals its columns, each
 * with its own checkbox. Deselecting a column is REAL enforcement rather than
 * concealment — the view's CTE is projected to the selected columns, so the
 * column ceases to exist for the agent, the GUI and any query (see
 * lib/views/resolve.ts). That's something we cannot honestly offer for a raw
 * table's columns, where a hand-written SELECT could still name them.
 *
 * Clicking a view expands it IN PLACE into the full question editor
 * (ViewWorkbench). Inherited views are listed read-only. A view the loader had
 * to DISABLE (e.g. an ancestor pulled a table it reads) is shown with its
 * reason, rather than silently vanishing.
 */

import React, { useState } from 'react';
import { Box, VStack, HStack, Text, Button, Icon } from '@chakra-ui/react';
import { LuPlus, LuEye, LuTable, LuChevronRight, LuChevronDown, LuBan, LuColumns3 } from 'react-icons/lu';
import { Checkbox } from '@/components/ui/checkbox';
import ViewWorkbench from './ViewWorkbench';
import { VIEWS_SCHEMA } from '@/lib/types';
import type { ViewDef, ViewProblem } from '@/lib/types';

interface ViewsSectionProps {
  contextPath: string;
  connection: string;
  views: ViewDef[];
  inheritedViews: ViewDef[];
  problems?: ViewProblem[];
  onViewsChange?: (next: ViewDef[]) => void;
  namePrefix?: string;
}

type Editing = { kind: 'new' } | { kind: 'edit'; index: number } | null;

export default function ViewsSection({
  contextPath, connection, views, inheritedViews, problems = [], onViewsChange, namePrefix,
}: ViewsSectionProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const editable = !!onViewsChange;

  const mine = views.map((v, index) => ({ v, index })).filter(({ v }) => v.connection === connection);
  const inherited = inheritedViews.filter((v) => v.connection === connection);
  const problemOf = (name: string) => problems.find((p) => p.view === name)?.reason;

  if (!editable && mine.length === 0 && inherited.length === 0) return null;

  const upsert = (index: number | null, next: ViewDef) => {
    const all = index === null ? [...views, next] : views.map((v, i) => (i === index ? next : v));
    onViewsChange?.(all);
    setEditing(null);
  };
  const remove = (index: number) => {
    onViewsChange?.(views.filter((_, i) => i !== index));
    setEditing(null);
  };
  const patch = (index: number, changes: Partial<ViewDef>) => {
    onViewsChange?.(views.map((v, i) => (i === index ? { ...v, ...changes } : v)));
  };

  /** A view with no explicit column list exposes all of them. */
  const exposed = (v: ViewDef): string[] =>
    v.whitelistedColumns ?? (v.columns ?? []).map((c) => c.name);

  const toggleView = (index: number, v: ViewDef) => {
    const isOn = exposed(v).length > 0;
    patch(index, { whitelistedColumns: isOn ? [] : undefined });
  };

  const toggleColumn = (index: number, v: ViewDef, column: string) => {
    const all = (v.columns ?? []).map((c) => c.name);
    const current = new Set(exposed(v));
    if (current.has(column)) current.delete(column); else current.add(column);
    const next = all.filter((c) => current.has(c));
    patch(index, { whitelistedColumns: next.length === all.length ? undefined : next });
  };

  const viewRow = (v: ViewDef, index: number | null, inheritedRow = false) => {
    const disabled = problemOf(v.name);
    const cols = v.columns ?? [];
    const on = exposed(v);
    const isExpanded = expanded.has(v.name);
    const canEdit = editable && index !== null && !disabled;

    return (
      <React.Fragment key={`${inheritedRow ? 'inh' : 'own'}-${v.name}`}>
        <HStack
          aria-label={`View ${v.name}`}
          px={3} py={1.5} gap={2}
          borderBottom="1px solid" borderColor="border.muted"
          _hover={canEdit ? { bg: 'bg.muted' } : undefined}
          opacity={inheritedRow || disabled ? 0.75 : 1}
          width="100%"
        >
          {cols.length > 0 && !disabled && (
            <Box
              as="button"
              aria-label={`Toggle columns of ${v.name}`}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(v.name)) next.delete(v.name); else next.add(v.name);
                  return next;
                });
              }}
              color="fg.subtle"
              flexShrink={0}
            >
              <Icon as={isExpanded ? LuChevronDown : LuChevronRight} boxSize={3} />
            </Box>
          )}

          {editable && index !== null && !disabled && (
            <Box onClick={(e: React.MouseEvent) => e.stopPropagation()} flexShrink={0}>
              <Checkbox
                aria-label={`Expose view ${v.name}`}
                checked={on.length > 0}
                onCheckedChange={() => toggleView(index, v)}
              />
            </Box>
          )}

          <Icon as={disabled ? LuBan : LuEye} boxSize={3} color={disabled ? 'accent.danger' : 'accent.cyan'} flexShrink={0} />

          <Box
            as={canEdit ? 'button' : undefined}
            onClick={canEdit ? () => setEditing({ kind: 'edit', index }) : undefined}
            textAlign="left"
            flexShrink={0}
          >
            <Text fontSize="xs" fontWeight="600" fontFamily="mono">
              {VIEWS_SCHEMA}.{v.name}
            </Text>
          </Box>

          <Text flex={1} minW={0} fontSize="2xs" color={disabled ? 'accent.danger' : 'fg.muted'} truncate>
            {disabled ? `DISABLED — ${disabled}` : (v.description || '')}
          </Text>

          {!disabled && (
            <HStack gap={1} flexShrink={0} color="fg.subtle">
              <LuTable size={10} />
              <Text fontSize="10px" fontFamily="mono">
                {v.whitelistedColumns ? `${on.length}/${cols.length}` : cols.length} cols
              </Text>
            </HStack>
          )}

          {inheritedRow && (
            <Text fontSize="10px" fontWeight="600" color="accent.teal" fontFamily="mono" flexShrink={0}>
              inherited
            </Text>
          )}
        </HStack>

        {isExpanded && !disabled && cols.map((c) => (
          <HStack
            key={`${v.name}.${c.name}`}
            pl={9} pr={3} py={1} gap={2}
            borderBottom="1px solid" borderColor="border.muted"
            bg="bg.subtle"
          >
            {editable && index !== null && (
              <Checkbox
                aria-label={`Expose column ${v.name}.${c.name}`}
                checked={on.includes(c.name)}
                onCheckedChange={() => toggleColumn(index, v, c.name)}
              />
            )}
            <Icon as={LuColumns3} boxSize={3} color="fg.subtle" flexShrink={0} />
            <Text fontSize="xs" fontFamily="mono" flex={1} minW={0} truncate>{c.name}</Text>
            <Text fontSize="10px" fontFamily="mono" color="fg.subtle">{c.type}</Text>
          </HStack>
        ))}
      </React.Fragment>
    );
  };

  return (
    <VStack align="stretch" gap={0} onClick={(e) => e.stopPropagation()}>
      <Box px={3} py={1} bg="bg.subtle" borderBottom="1px solid" borderColor="border.muted">
        <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.02em">
          Views
        </Text>
      </Box>

      {inherited.map((v) => viewRow(v, null, true))}

      {mine.map(({ v, index }) => (
        editing?.kind === 'edit' && editing.index === index ? (
          <Box key={`edit-${v.name}`} p={2}>
            <ViewWorkbench
              contextPath={contextPath}
              connection={connection}
              view={v}
              onSave={(next) => upsert(index, next)}
              onDelete={() => remove(index)}
              onCancel={() => setEditing(null)}
            />
          </Box>
        ) : viewRow(v, index)
      ))}

      {editing?.kind === 'new' && (
        <Box p={2}>
          <ViewWorkbench
            contextPath={contextPath}
            connection={connection}
            defaultName={namePrefix ? `${namePrefix}_` : ''}
            onSave={(next) => upsert(null, next)}
            onCancel={() => setEditing(null)}
          />
        </Box>
      )}

      {editable && !editing && (
        <Box px={3} py={1}>
          <Button aria-label={`Add view to ${connection}`} size="2xs" variant="ghost" onClick={() => setEditing({ kind: 'new' })}>
            <LuPlus /> New view
          </Button>
        </Box>
      )}
    </VStack>
  );
}
