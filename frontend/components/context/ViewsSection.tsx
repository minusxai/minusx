'use client';

/**
 * ViewsSection — the `_views` area of the whitelist UI.
 *
 * Views are curated SQL that behave like tables. This renders them as a
 * first-class section per connection: each view is a row (name · columns ·
 * description) that expands IN PLACE into the full workbench (ViewWorkbench) —
 * write SQL, run it, see rows, save. Inherited views (from an ancestor context)
 * are listed read-only, so you can see what you already have without being able
 * to silently change someone else's definition.
 */

import React, { useState } from 'react';
import { Box, VStack, HStack, Text, Button, Icon } from '@chakra-ui/react';
import { LuPlus, LuEye, LuTable } from 'react-icons/lu';
import ViewWorkbench from './ViewWorkbench';
import { VIEWS_SCHEMA } from '@/lib/types';
import type { ViewDef } from '@/lib/types';

interface ViewsSectionProps {
  /** Path of the context file being edited (resolves nested views + whitelist). */
  contextPath: string;
  connection: string;
  /** Views defined by THIS context (editable). */
  views: ViewDef[];
  /** Views inherited from ancestor contexts (read-only here). */
  inheritedViews: ViewDef[];
  /** Emits the next full views array. When omitted, the section is read-only. */
  onViewsChange?: (next: ViewDef[]) => void;
  /** Folder name, used to pre-fill a sensible view name (e.g. "sales_"). */
  namePrefix?: string;
}

type Editing = { kind: 'new' } | { kind: 'edit'; index: number } | null;

export default function ViewsSection({
  contextPath, connection, views, inheritedViews, onViewsChange, namePrefix,
}: ViewsSectionProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const editable = !!onViewsChange;

  const mine = views.map((v, index) => ({ v, index })).filter(({ v }) => v.connection === connection);
  const inherited = inheritedViews.filter((v) => v.connection === connection);

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

  const row = (v: ViewDef, onClick?: () => void, inheritedRow = false) => (
    <HStack
      key={`${inheritedRow ? 'inh' : 'own'}-${v.name}`}
      aria-label={`View ${v.name}`}
      as={onClick ? 'button' : undefined}
      px={3} py={1.5} gap={2}
      borderBottom="1px solid" borderColor="border.muted"
      _hover={onClick ? { bg: 'bg.muted' } : undefined}
      cursor={onClick ? 'pointer' : 'default'}
      opacity={inheritedRow ? 0.75 : 1}
      onClick={onClick}
      width="100%"
      textAlign="left"
    >
      <Icon as={LuEye} boxSize={3} color="accent.cyan" flexShrink={0} />
      <Text fontSize="xs" fontWeight="600" fontFamily="mono" flexShrink={0}>
        {VIEWS_SCHEMA}.{v.name}
      </Text>
      <Text flex={1} minW={0} fontSize="2xs" color="fg.muted" truncate>
        {v.description || ''}
      </Text>
      <HStack gap={1} flexShrink={0} color="fg.subtle">
        <LuTable size={10} />
        <Text fontSize="10px" fontFamily="mono">{v.columns?.length ?? 0} cols</Text>
      </HStack>
      {inheritedRow && (
        <Text fontSize="10px" fontWeight="600" color="accent.teal" fontFamily="mono" flexShrink={0}>
          inherited
        </Text>
      )}
    </HStack>
  );

  return (
    <VStack align="stretch" gap={0} onClick={(e) => e.stopPropagation()}>
      <Box px={3} py={1} bg="bg.subtle" borderBottom="1px solid" borderColor="border.muted">
        <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.02em">
          Views
        </Text>
      </Box>

      {inherited.map((v) => row(v, undefined, true))}

      {mine.map(({ v, index }) => (
        <React.Fragment key={`own-${v.name}`}>
          {editing?.kind === 'edit' && editing.index === index ? (
            <Box p={2}>
              <ViewWorkbench
                contextPath={contextPath}
                connection={connection}
                view={v}
                onSave={(next) => upsert(index, next)}
                onDelete={() => remove(index)}
                onCancel={() => setEditing(null)}
              />
            </Box>
          ) : (
            row(v, editable ? () => setEditing({ kind: 'edit', index }) : undefined)
          )}
        </React.Fragment>
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
