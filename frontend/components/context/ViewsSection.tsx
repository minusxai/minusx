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
 * edit mode, read-only when just inspecting (view mode / inherited). A view the
 * loader had to DISABLE (an ancestor pulled a table it reads) shows its reason.
 *
 * INHERITANCE works exactly as it does for tables, in both directions:
 *  · `inheritedViews` is what the parent OFFERS (the loader's `parentViews`), and
 *    its checkbox is the CHILD's say — a whitelist over the offered names
 *    (`viewWhitelist`, '*' by default), same shape as the table whitelist. An
 *    unchecked row stays listed, so it can be taken back.
 *  · an own view's "Apply to:" picker is the PARENT's say — which child paths
 *    receive it (`childPaths`), the same control a schema/table row carries.
 *
 * DELETE lives on the row (edit mode, own views), not only in the workbench
 * footer: a DISABLED view opens read-only, and a delete reachable only from that
 * footer left it unremovable.
 */

import React, { useState } from 'react';
import { Box, VStack, HStack, Text, Button, Icon } from '@chakra-ui/react';
import { LuPlus, LuEye, LuEyeOff, LuBox, LuChevronRight, LuChevronDown, LuBan } from 'react-icons/lu';
import { Checkbox } from '@/components/ui/checkbox';
import SchemaColumnRow from '@/components/schema-browser/SchemaColumnRow';
import ChildPathSelector from '@/components/selectors/ChildPathSelector';
import DeleteRowButton from '@/components/context/DeleteRowButton';
import ViewWorkbench from './ViewWorkbench';
import { nameWhitelisted, toggleNameWhitelist } from '@/lib/context/name-whitelist';
import { VIEWS_SCHEMA } from '@/lib/types';
import type { NameWhitelist, ViewDef, ViewProblem } from '@/lib/types';

interface ViewsSectionProps {
  contextPath: string;
  connection: string;
  views: ViewDef[];
  /** What the parent OFFERS this context (the loader's `parentViews`). */
  inheritedViews: ViewDef[];
  problems?: ViewProblem[];
  onViewsChange?: (next: ViewDef[]) => void;
  /** This context's selection out of `inheritedViews`; absent = '*' = all. */
  viewWhitelist?: NameWhitelist;
  onViewWhitelistChange?: (next: NameWhitelist) => void;
  /** Child folders an own view can be scoped to; empty hides the picker. */
  availableChildPaths?: string[];
  namePrefix?: string;
}

/**
 * What's open. Note there is NO 'edit' vs 'inspect' distinction stored here:
 * whether an open definition is editable is DERIVED at render time from the
 * current mode (see `canEditDef`). Storing it froze the mode at open time — a
 * definition opened in view mode stayed read-only after the user clicked Edit
 * (and vice versa), leaving a Monaco that refuses input inside a fully editable
 * row.
 */
type Editing =
  | { kind: 'new' }
  | { kind: 'def'; name: string; index: number | null }
  | null;

export default function ViewsSection({
  contextPath, connection, views, inheritedViews, problems = [], onViewsChange,
  viewWhitelist, onViewWhitelistChange, availableChildPaths = [], namePrefix,
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

  /**
   * An INHERITED row's checkbox is a different question from an own row's: not
   * "which columns are exposed" (we cannot rewrite the ancestor's definition) but
   * "do we take this at all" — a whitelist over the offered names. Unchecking
   * narrows the whitelist; the row stays listed either way.
   */
  const taken = (v: ViewDef) => nameWhitelisted(viewWhitelist, v.name);
  const toggleInherited = (v: ViewDef) => {
    // Offered names across ALL connections, not just this section's: model names
    // are unique tree-wide, so the whitelist is ONE list. Expanding '*' against
    // only this connection's names would silently drop every other connection's.
    onViewWhitelistChange?.(toggleNameWhitelist(viewWhitelist, inheritedViews.map((x) => x.name), v.name));
  };

  /** How many data models actually reach an agent — a DISABLED one never does. */
  const exposedCount =
    mine.filter(({ v }) => !problemOf(v.name) && exposed(v).length > 0).length +
    inherited.filter((v) => !problemOf(v.name) && taken(v)).length;

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

  /** The eye button: open the definition — editable or not is decided at render. */
  const openDefinition = (v: ViewDef, index: number | null) =>
    setEditing({ kind: 'def', name: v.name, index });

  /**
   * May this open definition be EDITED right now? Recomputed every render, so
   * toggling the context between view and edit mode re-arms (or disarms) an
   * already-open workbench. An inherited model (no index) or one the loader
   * DISABLED is inspect-only in either mode.
   */
  const canEditDef = (v: ViewDef, index: number | null): index is number =>
    editable && index !== null && !problemOf(v.name);

  /** Is this view's definition panel open? */
  const isDefOpen = (v: ViewDef, index: number | null) =>
    editing?.kind === 'def' && editing.name === v.name && editing.index === index;

  const viewRow = (v: ViewDef, index: number | null, inheritedRow = false) => {
    const disabled = problemOf(v.name);
    const cols = v.columns ?? [];
    const on = exposed(v);
    const isExpanded = expanded.has(v.name);
    const isOwn = index !== null;
    const canToggle = inheritedRow
      ? editable && !!onViewWhitelistChange
      : editable && isOwn && !disabled;
    const checked = inheritedRow ? taken(v) : on.length > 0;

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
                  checked={checked}
                  onCheckedChange={canToggle
                    ? () => (inheritedRow ? toggleInherited(v) : toggleView(index!, v))
                    : undefined}
                  disabled={!canToggle}
                />
              </Box>
            )}

            <Icon
              as={disabled ? LuBan : LuBox}
              boxSize={3}
              color={disabled ? 'accent.danger' : 'accent.teal'}
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
            {/* Which children receive this model — the parent's half of
                inheritance, same control (and placement) a schema row carries. */}
            {editable && isOwn && availableChildPaths.length > 0 && (
              <Box onClick={(e: React.MouseEvent) => e.stopPropagation()} flexShrink={0}>
                <ChildPathSelector
                  subject={`data model ${v.name}`}
                  availablePaths={availableChildPaths}
                  selectedPaths={v.childPaths}
                  onChange={(paths) => patch(index!, { childPaths: paths })}
                />
              </Box>
            )}
            {(() => {
              const open = isDefOpen(v, index);
              return (
                <Box
                  as="button"
                  aria-label={`Definition of ${v.name}`}
                  title={open ? 'Hide definition' : 'View definition'}
                  display="flex" alignItems="center" gap={1} px={1.5} py={0.5}
                  fontSize="10px" fontWeight="600" fontFamily="mono"
                  color={open ? 'fg.muted' : 'accent.teal'}
                  bg={open ? 'bg.muted' : 'transparent'}
                  borderRadius="sm" cursor="pointer" transition="all 0.15s"
                  _hover={{ bg: open ? 'bg.emphasized' : 'accent.teal/10' }}
                  onClick={(e: React.MouseEvent) => { e.stopPropagation(); open ? setEditing(null) : openDefinition(v, index); }}
                >
                  {open ? <LuEyeOff size={11} /> : <LuEye size={11} />} {open ? 'Hide' : 'Definition'}
                </Box>
              );
            })()}
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
            {/* Deliberately NOT gated on `disabled`: a model DISABLED by an
                ancestor's narrowing is exactly the one you most need to remove. */}
            {editable && isOwn && (
              <DeleteRowButton label={`Delete view ${v.name}`} onClick={() => remove(index!)} />
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

  /** The row, with its definition panel expanded BELOW it when open (the eye toggles it). */
  const renderRow = (v: ViewDef, index: number | null, inheritedRow: boolean) => (
    <React.Fragment key={`row-${inheritedRow ? 'inh' : 'own'}-${v.name}`}>
      {viewRow(v, index, inheritedRow)}
      {isDefOpen(v, index) && (
        <Box px={2} pb={2}>
          <ViewWorkbench
            contextPath={contextPath}
            connection={connection}
            view={v}
            readOnly={!canEditDef(v, index)}
            {...(canEditDef(v, index) ? {
              onSave: (next: ViewDef) => upsert(index, next),
              onDelete: () => remove(index),
            } : {})}
            onCancel={() => setEditing(null)}
          />
        </Box>
      )}
    </React.Fragment>
  );

  return (
    <VStack align="stretch" gap={0} onClick={(e) => e.stopPropagation()}>
      <HStack px={3} py={1} bg="bg.subtle" borderBottom="1px solid" borderColor="border.muted" gap={1.5}>
        <Icon as={LuBox} boxSize={3} color="accent.teal" />
        <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.02em">
          Data Models
        </Text>
        {/* Like the schema/table counters, the number is exposed-of-total — a plain
            total would hide that an unchecked data model reaches no agent. */}
        {inherited.length + mine.length > 0 && (
          <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">
            {exposedCount}/{inherited.length + mine.length}
          </Text>
        )}
      </HStack>

      {inherited.map((v) => renderRow(v, null, true))}
      {mine.map(({ v, index }) => renderRow(v, index, false))}

      {editable && mine.length === 0 && inherited.length === 0 && editing?.kind !== 'new' && (
        <Text px={3} py={2} fontSize="xs" color="fg.muted">
          No data models yet — create curated SQL that behaves like a table for this connection.
        </Text>
      )}

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
            <LuPlus /> New Data Model
          </Button>
        </Box>
      )}
    </VStack>
  );
}
