'use client';

/**
 * ViewsSection — the `_views` area of the whitelist UI.
 *
 * Views are curated SQL that behave like tables, so they are whitelisted with
 * the SAME row UI tables use: a real exposure checkbox (shown in both modes,
 * disabled when not editing) and column rows rendered by the shared
 * `SchemaColumnRow` (colored types, per-column checkbox). Deselecting a column
 * is REAL enforcement — the view's CTE is projected to the selected columns, so
 * the column ceases to exist for the agent, the GUI and any query (see
 * lib/views/resolve.ts). That is something we cannot honestly offer for a raw
 * table's columns, where a hand-written SELECT could still name them — hence a
 * view carries per-column checkboxes a table doesn't.
 *
 * The eye button — mirroring the table row's "Preview" affordance — opens the
 * view's definition in the real question editor (ViewWorkbench): editable in
 * edit mode, read-only when just inspecting (view mode / inherited). Inherited
 * views are read-only (disabled checkbox + badge); a view the loader had to
 * DISABLE (an ancestor pulled a table it reads) shows its reason.
 */

import React, { useState } from 'react';
import { Box, VStack, HStack, Text, Button, Icon } from '@chakra-ui/react';
import { LuPlus, LuEye, LuTable, LuChevronRight, LuChevronDown, LuBan } from 'react-icons/lu';
import { Checkbox } from '@/components/ui/checkbox';
import SchemaColumnRow from '@/components/schema-browser/SchemaColumnRow';
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

type Editing =
  | { kind: 'new' }
  | { kind: 'edit'; index: number }
  | { kind: 'inspect'; name: string }
  | null;

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

  const toggleExpanded = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  /** The eye button: edit the definition in place (edit mode) or inspect it read-only. */
  const openDefinition = (v: ViewDef, index: number | null) => {
    if (editable && index !== null && !problemOf(v.name)) setEditing({ kind: 'edit', index });
    else setEditing({ kind: 'inspect', name: v.name });
  };

  const viewRow = (v: ViewDef, index: number | null, inheritedRow = false) => {
    const disabled = problemOf(v.name);
    const cols = v.columns ?? [];
    const on = exposed(v);
    const isExpanded = expanded.has(v.name);
    const canToggle = editable && index !== null && !disabled;

    return (
      <React.Fragment key={`${inheritedRow ? 'inh' : 'own'}-${v.name}`}>
        <HStack
          aria-label={`View ${v.name}`}
          pl={3} pr={3} py={1.5} gap={1.5}
          borderBottom="1px solid" borderColor="border.muted"
          _hover={{ bg: 'bg.muted' }}
          opacity={inheritedRow || disabled ? 0.75 : 1}
          width="100%"
        >
          <HStack gap={1.5} flex={1} minW={0}>
            {cols.length > 0 && !disabled ? (
              <Box
                as="button"
                aria-label={`Toggle columns of ${v.name}`}
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); toggleExpanded(v.name); }}
                color="fg.subtle" cursor="pointer" flexShrink={0}
              >
                <Icon as={isExpanded ? LuChevronDown : LuChevronRight} boxSize={3} />
              </Box>
            ) : <Box w={3} flexShrink={0} />}

            {!disabled && (
              <Box onClick={(e: React.MouseEvent) => e.stopPropagation()} flexShrink={0}>
                <Checkbox
                  aria-label={`Expose view ${v.name}`}
                  checked={on.length > 0}
                  onCheckedChange={canToggle ? () => toggleView(index!, v) : undefined}
                  disabled={!canToggle}
                />
              </Box>
            )}

            <Icon
              as={disabled ? LuBan : LuTable}
              boxSize={3}
              color={disabled ? 'accent.danger' : 'fg.muted'}
              flexShrink={0}
            />
            <Text
              fontSize="xs" fontWeight="500" fontFamily="mono"
              color={disabled ? 'accent.danger' : 'fg.default'}
              textOverflow="ellipsis" overflow="hidden" whiteSpace="nowrap"
              minW={0} title={`${VIEWS_SCHEMA}.${v.name}`}
            >
              {VIEWS_SCHEMA}.{v.name}
            </Text>
          </HStack>

          <Text flex={1} minW={0} fontSize="2xs" color={disabled ? 'accent.danger' : 'fg.muted'} truncate>
            {disabled ? `DISABLED — ${disabled}` : (v.description || '')}
          </Text>

          <HStack gap={2} flexShrink={0}>
            <Box
              as="button"
              aria-label={`Definition of ${v.name}`}
              title="View definition"
              display="flex" alignItems="center" gap={1} px={1.5} py={0.5}
              fontSize="10px" fontWeight="600" fontFamily="mono" color="accent.teal"
              borderRadius="sm" cursor="pointer" transition="all 0.15s"
              _hover={{ bg: 'accent.teal/10' }}
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); openDefinition(v, index); }}
            >
              <LuEye size={11} /> Definition
            </Box>
            {!disabled && (
              <Text fontSize="10px" fontWeight="600" color="fg.subtle" fontFamily="mono">
                {v.whitelistedColumns ? `${on.length}/${cols.length}` : cols.length} cols
              </Text>
            )}
            {inheritedRow && (
              <Text fontSize="10px" fontWeight="600" color="accent.teal" fontFamily="mono">
                inherited
              </Text>
            )}
          </HStack>
        </HStack>

        {isExpanded && !disabled && (
          <Box ml={6} borderLeft="1px solid" borderColor="border.muted">
            {cols.map((c) => (
              <SchemaColumnRow
                key={c.name}
                ariaLabel={`Column ${v.name}.${c.name}`}
                name={c.name}
                type={c.type}
                selection={{
                  checked: on.includes(c.name),
                  onToggle: canToggle ? () => toggleColumn(index!, v, c.name) : undefined,
                  ariaLabel: `Expose column ${v.name}.${c.name}`,
                }}
              />
            ))}
          </Box>
        )}
      </React.Fragment>
    );
  };

  /** A row, unless it's the one being edited/inspected — then the workbench takes its place. */
  const renderRow = (v: ViewDef, index: number | null, inheritedRow: boolean) => {
    if (editing?.kind === 'edit' && index !== null && editing.index === index) {
      return (
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
      );
    }
    if (editing?.kind === 'inspect' && editing.name === v.name) {
      return (
        <Box key={`inspect-${v.name}`} p={2}>
          <ViewWorkbench
            contextPath={contextPath}
            connection={connection}
            view={v}
            readOnly
            onCancel={() => setEditing(null)}
          />
        </Box>
      );
    }
    return viewRow(v, index, inheritedRow);
  };

  return (
    <VStack align="stretch" gap={0} onClick={(e) => e.stopPropagation()}>
      <Box px={3} py={1} bg="bg.subtle" borderBottom="1px solid" borderColor="border.muted">
        <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.02em">
          Views
        </Text>
      </Box>

      {inherited.map((v) => renderRow(v, null, true))}
      {mine.map(({ v, index }) => renderRow(v, index, false))}

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
