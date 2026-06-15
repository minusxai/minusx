'use client';

/**
 * TableMetricsEditor — per-table metric editing, rendered inside the schema tree
 * (as rows above the table's columns). Metrics are stored on the context (the
 * full array is passed in and emitted back via onMetricsChange); this view scopes
 * to one table and tags new metrics with that table's connection/schema/table.
 *
 * Each metric is a row (ƒ name · description · "metric"); clicking it opens an
 * inline popover editor (name / description / SQL). A freshly added (unnamed)
 * metric auto-opens its editor; cancelling an unnamed one discards it.
 */

import { useState, useEffect, useRef } from 'react';
import { Box, HStack, VStack, Text, Icon, Button, Input, Textarea, Field, Popover, Portal } from '@chakra-ui/react';
import { LuSquareFunction, LuPlus } from 'react-icons/lu';
import type { MetricDef } from '@/lib/types';

interface TableMetricsEditorProps {
  connection?: string;
  schema: string;
  table: string;
  /** All context metrics (full array). */
  metrics: MetricDef[];
  /** Emits the next full metrics array. When omitted, metrics are read-only. */
  onMetricsChange?: (next: MetricDef[]) => void;
  /** Inherited metrics (read-only) attached to this table. */
  inheritedMetrics?: MetricDef[];
}

function matchesTable(m: MetricDef, connection: string | undefined, schema: string, table: string) {
  return m.schema === schema && m.table === table && (m.connection == null || m.connection === connection);
}

function MetricRow({ metric, editable, inherited, onChange, onDelete }: {
  metric: MetricDef; editable: boolean; inherited?: boolean; onChange: (next: MetricDef) => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(metric.name);
  const [description, setDescription] = useState(metric.description ?? '');
  const [sql, setSql] = useState(metric.sql ?? '');

  // Auto-open the editor for a freshly added (unnamed) metric.
  const didMount = useRef(false);
  useEffect(() => {
    if (didMount.current) return;
    didMount.current = true;
    if (editable && !metric.name) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
    }
  }, [editable, metric.name]);

  const seed = () => { setName(metric.name); setDescription(metric.description ?? ''); setSql(metric.sql ?? ''); };

  const save = () => {
    if (!name.trim()) return;
    onChange({ ...metric, name: name.trim(), description: description.trim() || undefined, sql: sql.trim() || undefined });
    setOpen(false);
  };

  const cancel = () => {
    if (!metric.name) onDelete(); // discard a never-named metric
    setOpen(false);
  };

  const row = (
    <HStack
      pl={3}
      pr={3}
      py={1}
      gap={2}
      borderBottom="1px solid"
      borderColor="border.muted"
      _hover={{ bg: 'bg.muted' }}
      transition="background 0.1s"
      cursor={editable ? 'pointer' : 'default'}
      opacity={inherited ? 0.7 : 1}
    >
      <HStack gap={1.5} w="160px" flexShrink={0} minW={0}>
        <Icon as={LuSquareFunction} boxSize={3} color="accent.teal" flexShrink={0} />
        <Text fontSize="xs" fontWeight="600" fontFamily="mono" color="fg.default" truncate title={metric.name}>
          {metric.name || 'Untitled'}
        </Text>
      </HStack>
      <Text flex={1} minW={0} fontSize="2xs" color="fg.muted" truncate title={metric.description}>
        {metric.description || (editable && !metric.sql ? 'Click to define…' : '')}
      </Text>
      {metric.sql ? (
        <Text flex={1.5} minW={0} fontSize="2xs" fontFamily="mono" color="fg.subtle" truncate title={metric.sql}>
          {metric.sql.replace(/\s+/g, ' ').trim()}
        </Text>
      ) : (
        <Box flex={1.5} minW={0} />
      )}
      {inherited && (
        <Text fontSize="10px" fontWeight="600" color="accent.teal" fontFamily="mono" flexShrink={0}>
          inherited
        </Text>
      )}
    </HStack>
  );

  if (!editable) return row;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(e: { open: boolean }) => { if (e.open) { seed(); setOpen(true); } else { cancel(); } }}
      positioning={{ placement: 'bottom-start' }}
    >
      <Popover.Trigger asChild>
        <Box onClick={(e: React.MouseEvent) => e.stopPropagation()}>{row}</Box>
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content width="420px" bg="bg.surface" borderRadius="md" border="1px solid" borderColor="border.muted" boxShadow="lg">
            <Popover.Body p={3}>
              <VStack gap={3} align="stretch">
                <Field.Root required>
                  <Field.Label>Name</Field.Label>
                  <Input aria-label="Metric name" size="sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Monthly Revenue" autoFocus />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Description</Field.Label>
                  <Input aria-label="Metric description" size="sm" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One-line summary (optional)" />
                </Field.Root>
                <Field.Root>
                  <Field.Label>SQL (optional)</Field.Label>
                  <Textarea aria-label="Metric SQL" value={sql} onChange={(e) => setSql(e.target.value)} placeholder="SELECT ..." rows={5}
                    fontFamily="var(--font-jetbrains-mono), monospace" fontSize="xs" />
                </Field.Root>
                <HStack justify="space-between">
                  <Button size="xs" variant="ghost" colorPalette="red" onClick={onDelete}>Delete</Button>
                  <HStack gap={2}>
                    <Button size="xs" variant="outline" onClick={cancel}>Cancel</Button>
                    <Button size="xs" bg="accent.teal" color="white" onClick={save} disabled={!name.trim()}>Save</Button>
                  </HStack>
                </HStack>
              </VStack>
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}

export default function TableMetricsEditor({ connection, schema, table, metrics, onMetricsChange, inheritedMetrics }: TableMetricsEditorProps) {
  const editable = !!onMetricsChange;
  const items = metrics.map((m, idx) => ({ m, idx })).filter(({ m }) => matchesTable(m, connection, schema, table));
  const inherited = (inheritedMetrics || []).filter((m) => matchesTable(m, connection, schema, table));

  if (!editable && items.length === 0 && inherited.length === 0) return null;

  const addMetric = () => onMetricsChange?.([...metrics, { name: '', connection, schema, table }]);
  const updateAt = (idx: number, next: MetricDef) => onMetricsChange?.(metrics.map((m, i) => (i === idx ? next : m)));
  const removeAt = (idx: number) => onMetricsChange?.(metrics.filter((_, i) => i !== idx));

  return (
    <VStack gap={0} align="stretch" onClick={(e) => e.stopPropagation()}>
      <Box px={3} py={1} bg="bg.subtle" borderBottom="1px solid" borderColor="border.muted">
        <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.02em">Metrics</Text>
      </Box>
      {inherited.map((m, i) => (
        <MetricRow key={`inh-${i}-${m.name}`} metric={m} editable={false} inherited onChange={() => {}} onDelete={() => {}} />
      ))}
      {items.map(({ m, idx }) => (
        <MetricRow key={`${idx}-${m.name}`} metric={m} editable={editable} onChange={(n) => updateAt(idx, n)} onDelete={() => removeAt(idx)} />
      ))}
      {editable && (
        <Box pl={3} pr={3} py={1} onClick={(e) => e.stopPropagation()}>
          <Button aria-label={`Add metric to ${schema}.${table}`} size="2xs" variant="ghost" onClick={addMetric}>
            <LuPlus /> Add metric
          </Button>
        </Box>
      )}
    </VStack>
  );
}
