'use client';

/**
 * TableRelationshipsEditor — per-table FK relationship editing, rendered inside
 * the schema tree (rows above the table's columns, next to metrics). A
 * relationship declares "this table's FK column looks up that table's column"
 * with lookup-only cardinality (many_to_one / one_to_one) — the single authored
 * input the derived semantic layer needs (lib/semantic/derive.ts); dimensions,
 * measures and time axes all derive from the schema itself.
 *
 * Relationships are stored on the context version (the full array is passed in
 * and emitted back via onRelationshipsChange); this view scopes to one table
 * and tags new entries with that table's connection/schema/table. Dropdowns are
 * driven by the schema's columns; when the schema was bounded to names-only,
 * they fall back to free-text inputs so authoring is never blocked.
 */

import { useState, useEffect, useRef } from 'react';
import { Box, HStack, VStack, Text, Icon, Button, Input, Field, Popover, Portal } from '@chakra-ui/react';
import { LuLink, LuPlus, LuCircleCheck, LuCircleX } from 'react-icons/lu';
import type { TableRelationship } from '@/lib/types';

interface VerifyState {
  status: 'idle' | 'running' | 'done' | 'error';
  targetUnique?: boolean;
  totalRows?: number;
  matchedRows?: number;
  message?: string;
}

interface TableColumns {
  schema: string;
  table: string;
  columns: Array<{ name: string; type: string }>;
}

interface TableRelationshipsEditorProps {
  connection?: string;
  schema: string;
  table: string;
  /** This table's columns (may be [] when the schema is names-only). */
  columns: Array<{ name: string; type: string }>;
  /** All tables in this connection — join target candidates. */
  tables: TableColumns[];
  /** All context relationships (full array). */
  relationships: TableRelationship[];
  /** Emits the next full relationships array. When omitted, read-only. */
  onRelationshipsChange?: (next: TableRelationship[]) => void;
  /** Inherited relationships (read-only) attached to this table. */
  inheritedRelationships?: TableRelationship[];
}

function matchesTable(r: TableRelationship, connection: string | undefined, schema: string, table: string) {
  return (r.schema ?? '') === schema && r.table === table && (r.connection == null || r.connection === connection);
}

const selectStyle: React.CSSProperties = {
  fontSize: '12px',
  fontFamily: 'var(--font-jetbrains-mono), monospace',
  padding: '0 6px',
  border: '1px solid var(--chakra-colors-border-muted)',
  borderRadius: '6px',
  background: 'var(--chakra-colors-bg-canvas)',
  color: 'var(--chakra-colors-fg-default)',
  outline: 'none',
  height: '32px',
  cursor: 'pointer',
  width: '100%',
};

/** Dropdown when options are known, free-text input otherwise. */
function ColumnField({ label, options, value, onChange }: {
  label: string; options: string[]; value: string; onChange: (v: string) => void;
}) {
  if (options.length === 0) {
    return (
      <Input aria-label={label} size="sm" fontFamily="mono" fontSize="xs"
        value={value} onChange={(e) => onChange(e.target.value)} placeholder="column name" />
    );
  }
  return (
    <select aria-label={label} style={selectStyle} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select column…</option>
      {options.map((c) => <option key={c} value={c}>{c}</option>)}
      {value && !options.includes(value) && <option value={value}>{value}</option>}
    </select>
  );
}

function RelationshipRow({ rel, editable, inherited, tables, columns, onChange, onDelete }: {
  rel: TableRelationship;
  editable: boolean;
  inherited?: boolean;
  tables: TableColumns[];
  columns: Array<{ name: string; type: string }>;
  onChange: (next: TableRelationship) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [column, setColumn] = useState(rel.column);
  const [target, setTarget] = useState(rel.targetTable ? `${rel.targetSchema ?? ''}.${rel.targetTable}` : '');
  const [targetColumn, setTargetColumn] = useState(rel.targetColumn);
  const [cardinality, setCardinality] = useState(rel.relationship ?? 'many_to_one');

  // Auto-open the editor for a freshly added (empty) relationship.
  const didMount = useRef(false);
  useEffect(() => {
    if (didMount.current) return;
    didMount.current = true;
    if (editable && !rel.column) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
    }
  }, [editable, rel.column]);

  const seed = () => {
    setColumn(rel.column);
    setTarget(rel.targetTable ? `${rel.targetSchema ?? ''}.${rel.targetTable}` : '');
    setTargetColumn(rel.targetColumn);
    setCardinality(rel.relationship ?? 'many_to_one');
  };

  const [targetSchema, targetTable] = target.includes('.')
    ? [target.slice(0, target.indexOf('.')), target.slice(target.indexOf('.') + 1)]
    : ['', target];
  const targetCols = tables.find((t) => t.schema === targetSchema && t.table === targetTable)?.columns ?? [];
  const complete = !!(column.trim() && targetTable.trim() && targetColumn.trim());

  const save = () => {
    if (!complete) return;
    onChange({
      ...rel,
      column: column.trim(),
      targetSchema: targetSchema || undefined,
      targetTable: targetTable.trim(),
      targetColumn: targetColumn.trim(),
      relationship: cardinality,
    });
    setOpen(false);
  };

  const cancel = () => {
    if (!rel.column) onDelete(); // discard a never-specified relationship
    setOpen(false);
  };

  // Verify runs the CURRENT form values against the live connection (target
  // uniqueness + FK match rate) — a claim check, not a save.
  const [verify, setVerify] = useState<VerifyState>({ status: 'idle' });
  const runVerify = async () => {
    setVerify({ status: 'running' });
    try {
      const res = await fetch('/api/relationships/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relationship: {
            ...rel,
            column: column.trim(),
            targetSchema: targetSchema || undefined,
            targetTable: targetTable.trim(),
            targetColumn: targetColumn.trim(),
            relationship: cardinality,
          },
        }),
      });
      const body = await res.json();
      if (!res.ok || !body?.success) {
        setVerify({ status: 'error', message: body?.error?.message ?? body?.error ?? 'Verification failed' });
        return;
      }
      setVerify({ status: 'done', ...body.data });
    } catch {
      setVerify({ status: 'error', message: 'Verification failed' });
    }
  };

  const label = `Relationship ${rel.column || '?'} → ${rel.targetTable || '?'}.${rel.targetColumn || '?'}`;
  const row = (
    <HStack
      aria-label={label}
      pl={3} pr={3} py={1} gap={2}
      borderBottom="1px solid" borderColor="border.muted"
      _hover={{ bg: 'bg.muted' }} transition="background 0.1s"
      cursor={editable ? 'pointer' : 'default'}
      opacity={inherited ? 0.7 : 1}
    >
      <HStack gap={1.5} flexShrink={0} minW={0}>
        <Icon as={LuLink} boxSize={3} color="accent.secondary" flexShrink={0} />
        <Text fontSize="xs" fontWeight="600" fontFamily="mono" color="fg.default" truncate>
          {rel.column || 'new relationship'}
        </Text>
      </HStack>
      <Text fontSize="xs" color="fg.subtle" flexShrink={0}>→</Text>
      <Text flex={1} minW={0} fontSize="xs" fontFamily="mono" color="fg.muted" truncate>
        {rel.targetTable ? `${rel.targetTable}.${rel.targetColumn}` : 'click to define…'}
      </Text>
      <Text fontSize="10px" fontWeight="600" color="fg.subtle" fontFamily="mono" flexShrink={0}>
        {(rel.relationship ?? 'many_to_one').replace(/_/g, '-')}
      </Text>
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
          <Popover.Content width="360px" bg="bg.surface" borderRadius="md" border="1px solid" borderColor="border.muted" boxShadow="lg">
            <Popover.Body p={3}>
              <VStack gap={3} align="stretch">
                <Field.Root required>
                  <Field.Label>Foreign key column</Field.Label>
                  <ColumnField label="Foreign key column" options={columns.map((c) => c.name)} value={column} onChange={setColumn} />
                </Field.Root>
                <Field.Root required>
                  <Field.Label>Target table</Field.Label>
                  {tables.length > 0 ? (
                    <select aria-label="Target table" style={selectStyle} value={target} onChange={(e) => { setTarget(e.target.value); setTargetColumn(''); }}>
                      <option value="">Select table…</option>
                      {tables.map((t) => (
                        <option key={`${t.schema}.${t.table}`} value={`${t.schema}.${t.table}`}>{t.schema}.{t.table}</option>
                      ))}
                    </select>
                  ) : (
                    <Input aria-label="Target table" size="sm" fontFamily="mono" fontSize="xs"
                      value={target} onChange={(e) => setTarget(e.target.value)} placeholder="schema.table" />
                  )}
                </Field.Root>
                <Field.Root required>
                  <Field.Label>Target column</Field.Label>
                  <ColumnField label="Target column" options={targetCols.map((c) => c.name)} value={targetColumn} onChange={setTargetColumn} />
                </Field.Root>
                <Field.Root>
                  <Field.Label>Cardinality</Field.Label>
                  <select aria-label="Cardinality" style={selectStyle} value={cardinality}
                    onChange={(e) => setCardinality(e.target.value as TableRelationship['relationship'] & string)}>
                    <option value="many_to_one">many-to-one (lookup)</option>
                    <option value="one_to_one">one-to-one</option>
                  </select>
                </Field.Root>
                {verify.status !== 'idle' && (
                  <HStack aria-label="Verification result" gap={1.5} fontSize="xs" fontFamily="mono"
                    color={verify.status === 'running' ? 'fg.muted' : verify.status === 'error' || verify.targetUnique === false ? 'accent.danger' : 'accent.teal'}>
                    {verify.status === 'running' ? (
                      <Text>Verifying against the database…</Text>
                    ) : verify.status === 'error' ? (
                      <><LuCircleX size={12} /><Text>{verify.message}</Text></>
                    ) : verify.targetUnique === false ? (
                      <><LuCircleX size={12} /><Text>Target column is not unique — measures would fan out through this join.</Text></>
                    ) : (
                      <><LuCircleCheck size={12} /><Text>
                        Valid lookup · {verify.totalRows ? `${Math.round(((verify.matchedRows ?? 0) / verify.totalRows) * 100)}% match (${verify.matchedRows}/${verify.totalRows} rows)` : 'no base rows'}
                      </Text></>
                    )}
                  </HStack>
                )}
                <HStack justify="space-between">
                  <Button aria-label="Delete relationship" size="xs" variant="ghost" colorPalette="red" onClick={onDelete}>Delete</Button>
                  <HStack gap={2}>
                    <Button aria-label="Verify relationship" size="xs" variant="outline" onClick={runVerify}
                      disabled={!complete} loading={verify.status === 'running'}>Verify</Button>
                    <Button aria-label="Cancel relationship" size="xs" variant="outline" onClick={cancel}>Cancel</Button>
                    <Button aria-label="Save relationship" size="xs" bg="accent.teal" color="white" onClick={save} disabled={!complete}>Save</Button>
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

export default function TableRelationshipsEditor({
  connection, schema, table, columns, tables, relationships, onRelationshipsChange, inheritedRelationships,
}: TableRelationshipsEditorProps) {
  const editable = !!onRelationshipsChange;
  // Self-joins are unsupported (lib/semantic/derive.ts) — never offer the base
  // table itself as a lookup target.
  const targetTables = tables.filter((t) => !(t.schema === schema && t.table === table));
  const items = relationships.map((r, idx) => ({ r, idx })).filter(({ r }) => matchesTable(r, connection, schema, table));
  const inherited = (inheritedRelationships || []).filter((r) => matchesTable(r, connection, schema, table));

  if (!editable && items.length === 0 && inherited.length === 0) return null;

  const addRelationship = () => onRelationshipsChange?.([
    ...relationships,
    { connection: connection ?? '', schema, table, column: '', targetTable: '', targetColumn: '', relationship: 'many_to_one' },
  ]);
  const updateAt = (idx: number, next: TableRelationship) =>
    onRelationshipsChange?.(relationships.map((r, i) => (i === idx ? next : r)));
  const removeAt = (idx: number) => onRelationshipsChange?.(relationships.filter((_, i) => i !== idx));

  return (
    <VStack gap={0} align="stretch" onClick={(e) => e.stopPropagation()}>
      <Box px={3} py={1} bg="bg.subtle" borderBottom="1px solid" borderColor="border.muted">
        <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.02em">Relationships</Text>
      </Box>
      {inherited.map((r, i) => (
        <RelationshipRow key={`inh-${i}`} rel={r} editable={false} inherited tables={targetTables} columns={columns}
          onChange={() => {}} onDelete={() => {}} />
      ))}
      {items.map(({ r, idx }) => (
        <RelationshipRow key={idx} rel={r} editable={editable} tables={targetTables} columns={columns}
          onChange={(n) => updateAt(idx, n)} onDelete={() => removeAt(idx)} />
      ))}
      {editable && (
        <Box pl={3} pr={3} py={1} onClick={(e) => e.stopPropagation()}>
          <Button aria-label={`Add relationship to ${schema}.${table}`} size="2xs" variant="ghost" onClick={addRelationship}>
            <LuPlus /> Add relationship
          </Button>
        </Box>
      )}
    </VStack>
  );
}
