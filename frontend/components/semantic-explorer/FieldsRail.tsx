'use client';

/**
 * FieldsRail — the left rail of the semantic explorer: the FULL field list of
 * the current model (measures / dimensions / time), independently scrollable,
 * with a search bar that filters it and surfaces matches from other tables.
 * Click-to-add is the primary interaction (every field has one home shelf);
 * rows are also draggable onto the shelves (disabled on touch devices).
 * Extracted from SemanticCanvas's picker pane.
 */

import React from 'react';
import { VStack, HStack, Text, Input, Icon } from '@chakra-ui/react';
import { LuSigma, LuGroup, LuClock, LuSearch, LuTable, LuCheck } from 'react-icons/lu';
import type { ModelStub } from '@/lib/semantic/derive';
import type { SemanticFieldHit } from '@/lib/semantic/models-client';
import type { SemanticModel } from '@/lib/types';
import type { SemanticQuerySpec } from '@/lib/validation/atlas-schemas';

/** What's being dragged from the rail (held by SemanticExplorer). */
export interface DraggingField {
  kind: 'measure' | 'dimension' | 'time';
  name: string;
  column?: string;
}

const matches = (q: string, name: string) => {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((t) => name.toLowerCase().includes(t));
};

interface FieldsRailProps {
  spec: SemanticQuerySpec | null;
  model?: SemanticModel;
  stubs: ModelStub[];
  browsingTables: boolean;
  onToggleBrowse: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  otherHits: SemanticFieldHit[];
  onPickStub: (stub: ModelStub) => void;
  onPickOtherHit: (hit: SemanticFieldHit) => void;
  onToggleMeasure: (name: string) => void;
  onToggleDimension: (name: string) => void;
  onToggleTime: (column?: string) => void;
  isTouchDevice: boolean;
  onFieldDragStart: (field: DraggingField) => void;
  onFieldDragEnd: () => void;
}

export function FieldsRail({
  spec, model, stubs, browsingTables, onToggleBrowse, query, onQueryChange,
  otherHits, onPickStub, onPickOtherHit,
  onToggleMeasure, onToggleDimension, onToggleTime,
  isTouchDevice, onFieldDragStart, onFieldDragEnd,
}: FieldsRailProps) {
  const effectiveTimeColumn = spec?.timeColumn ?? model?.timeDimension?.column;

  const fieldRow = (
    label: string,
    assigned: boolean,
    icon: React.ReactNode,
    onClick: () => void,
    ariaLabel: string,
    drag?: DraggingField,
  ) => (
    <HStack
      key={ariaLabel}
      aria-label={ariaLabel}
      as="button"
      gap={1.5} px={2} py={1}
      bg={assigned ? 'accent.teal/10' : 'transparent'}
      borderRadius="md" border="1px solid"
      borderColor={assigned ? 'accent.teal' : 'border.default'}
      cursor="pointer"
      _hover={{ bg: assigned ? 'accent.teal/15' : 'bg.muted' }}
      onClick={onClick}
      userSelect="none"
      width="100%"
      textAlign="left"
      flexShrink={0}
      draggable={!!drag && !isTouchDevice}
      onDragStart={drag ? (e: React.DragEvent) => {
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', drag.name);
        }
        onFieldDragStart(drag);
      } : undefined}
      onDragEnd={drag ? onFieldDragEnd : undefined}
    >
      {icon}
      <Text fontSize="xs" fontFamily="mono" truncate flex={1}>{label}</Text>
      {assigned && <LuCheck size={12} color="var(--chakra-colors-accent-teal)" />}
    </HStack>
  );

  const sectionHeader = (label: string) => (
    <Text key={`hdr-${label}`} fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" flexShrink={0}>
      {label}
    </Text>
  );

  const visibleMeasures = model ? model.measures.filter((m) => matches(query, m.name)) : [];
  const temporalDims = model ? model.dimensions.filter((d) => d.temporal && !d.join) : [];
  const visibleTemporal = temporalDims.filter((d) => matches(query, d.name));
  // The model default may lack a dimension entry (hand-authored models) — give it a row.
  const defaultHasRow = !model?.timeDimension || temporalDims.some((d) => d.column === model.timeDimension!.column);
  const defaultTimeLabel = model?.timeDimension?.label ?? model?.timeDimension?.column ?? 'Time';
  const visibleDefaultTime = !defaultHasRow && !!model?.timeDimension && matches(query, defaultTimeLabel);
  const visibleDimensions = model
    ? model.dimensions.filter((d) => !(d.temporal && !d.join) && d.column !== model.timeDimension?.column && matches(query, d.name))
    : [];
  const foreignHits = otherHits.filter((h) => h.model !== spec?.model).slice(0, 20);

  return (
    <VStack align="stretch" gap={2} w="240px" flexShrink={0} minH={0} maxH="100%">
      <HStack gap={1.5} px={2} bg="bg.surface" borderRadius="md" border="1px solid" borderColor="border.muted" flexShrink={0}>
        <LuSearch size={13} color="var(--chakra-colors-fg-subtle)" />
        <Input
          aria-label="Semantic field search"
          variant="subtle"
          bg="transparent"
          size="sm"
          fontFamily="mono"
          fontSize="xs"
          border="none"
          placeholder={model ? 'Filter measures & dimensions…' : 'Search fields across all tables…'}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </HStack>
      {spec && (
        <HStack
          as="button"
          aria-label="Change table"
          gap={1.5} px={2} py={1}
          borderRadius="md" border="1px solid" borderColor="border.muted"
          bg={browsingTables ? 'bg.muted' : 'bg.surface'}
          _hover={{ bg: 'bg.muted' }}
          onClick={onToggleBrowse}
          flexShrink={0}
          title="Pick a different table (starts a fresh query)"
        >
          <Icon as={LuTable} boxSize={3} color="fg.muted" flexShrink={0} />
          <Text fontSize="xs" fontFamily="mono" truncate flex={1} textAlign="left">{spec.model}</Text>
          <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">change ▾</Text>
        </HStack>
      )}
      <VStack align="stretch" gap={1.5} overflowY="auto" minH={0} flex={1} pr={1}>
        {!spec || browsingTables ? (
          <>
            {sectionHeader('Tables')}
            {stubs
              .filter((st) => matches(query, st.name))
              .slice(0, 200)
              .map((st) => fieldRow(
                st.name, false,
                <Icon as={LuTable} boxSize={3} color="fg.muted" flexShrink={0} />,
                () => onPickStub(st),
                `Pick table: ${st.name}`,
              ))}
          </>
        ) : !model ? (
          <Text fontSize="xs" color="fg.subtle" fontFamily="mono">Loading {spec.model}…</Text>
        ) : (
          <>
            {visibleMeasures.length > 0 && sectionHeader('Measures')}
            {visibleMeasures.map((m) => fieldRow(
              m.name,
              spec.measures.includes(m.name),
              <LuSigma size={12} color="var(--chakra-colors-accent-primary)" />,
              () => onToggleMeasure(m.name),
              `Field measure: ${m.name}`,
              { kind: 'measure', name: m.name },
            ))}
            {(visibleDimensions.length > 0 || visibleTemporal.length > 0 || visibleDefaultTime) && sectionHeader('Dimensions')}
            {visibleDefaultTime && fieldRow(
              defaultTimeLabel,
              !!spec.timeGrain && effectiveTimeColumn === model.timeDimension!.column,
              <LuClock size={12} color="var(--chakra-colors-accent-secondary)" />,
              () => onToggleTime(model.timeDimension!.column),
              `Field time: ${defaultTimeLabel}`,
              { kind: 'time', name: defaultTimeLabel, column: model.timeDimension!.column },
            )}
            {visibleTemporal.map((d) => fieldRow(
              d.name,
              (!!spec.timeGrain && effectiveTimeColumn === d.column) || spec.dimensions.includes(d.name),
              <LuClock size={12} color="var(--chakra-colors-accent-secondary)" />,
              () => (spec.dimensions.includes(d.name) ? onToggleDimension(d.name) : onToggleTime(d.column)),
              `Field time: ${d.name}`,
              { kind: 'time', name: d.name, column: d.column },
            ))}
            {visibleDimensions.map((d) => fieldRow(
              d.name,
              spec.dimensions.includes(d.name),
              <LuGroup size={12} color="var(--chakra-colors-accent-warning)" />,
              () => onToggleDimension(d.name),
              `Field dimension: ${d.name}`,
              { kind: 'dimension', name: d.name },
            ))}
          </>
        )}
        {foreignHits.length > 0 && (
          <>
            {sectionHeader('Other tables')}
            {foreignHits.map((h) => (
              <HStack
                key={`${h.kind}:${h.model}:${h.name}`}
                aria-label={`Other table field ${h.kind}: ${h.name} (${h.model})`}
                as="button"
                gap={1.5} px={2} py={1}
                borderRadius="md" border="1px dashed" borderColor="border.muted"
                _hover={{ bg: 'bg.muted' }}
                onClick={() => onPickOtherHit(h)}
                width="100%"
                textAlign="left"
                flexShrink={0}
              >
                {h.kind === 'measure'
                  ? <LuSigma size={12} color="var(--chakra-colors-accent-primary)" />
                  : <LuGroup size={12} color="var(--chakra-colors-accent-warning)" />}
                <Text fontSize="xs" fontFamily="mono" flex={1} truncate>{h.name}</Text>
                <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" truncate maxW="90px">{h.model}</Text>
              </HStack>
            ))}
          </>
        )}
      </VStack>
    </VStack>
  );
}
