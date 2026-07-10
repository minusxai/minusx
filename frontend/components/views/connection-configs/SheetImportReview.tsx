'use client';

/**
 * Agentic Sheets import — the confirm/redact review step. Pure view: the agent's proposed
 * tables arrive as props (transform + executed preview each); the user can exclude tables,
 * inspect the cleaned preview + the SQL the agent wrote, send feedback for a revision, and
 * confirm the import. All data flows through callbacks — no fetching here.
 */

import { useState } from 'react';
import { Box, Text, VStack, HStack, Button, Checkbox, Table, Textarea, Span } from '@chakra-ui/react';
import { LuCheck, LuSparkles, LuTable, LuTriangleAlert } from 'react-icons/lu';
import type { SheetTransform, TransformPreview } from '@/lib/sheets-import/types';

export interface SheetImportProposal {
  transform: SheetTransform;
  preview: TransformPreview;
  included: boolean;
}

export interface SheetImportReviewProps {
  proposals: SheetImportProposal[];
  /** Transforms the agent could not make runnable (shown as a warning). */
  dropped: string[];
  revising: boolean;
  confirming: boolean;
  /** Verb on the confirm button — "Import" for first imports (default), "Apply" for adjustments. */
  confirmLabel?: string;
  onToggle: (outputTable: string) => void;
  onRevise: (feedback: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const PREVIEW_ROW_LIMIT = 8;

function renderValue(v: unknown): string {
  if (v == null) return '∅';
  return String(v);
}

function ProposalCard({ proposal, onToggle }: { proposal: SheetImportProposal; onToggle: () => void }) {
  const { transform, preview, included } = proposal;
  const [showSql, setShowSql] = useState(false);
  const rows = preview.rows.slice(0, PREVIEW_ROW_LIMIT);

  return (
    <Box border="1px solid" borderColor="border.subtle" borderRadius="md" p={3} bg={included ? 'bg.default' : 'bg.muted'} opacity={included ? 1 : 0.6}>
      <HStack justify="space-between" mb={1}>
        <HStack gap={2}>
          <Checkbox.Root
            checked={included}
            onCheckedChange={onToggle}
            aria-label={`Include table ${transform.output_table}`}
            size="sm"
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control />
          </Checkbox.Root>
          <LuTable size={14} color="var(--chakra-colors-fg-muted)" />
          <Text fontSize="sm" fontFamily="mono" fontWeight="700">
            {transform.schema_name}.{transform.output_table}
          </Text>
        </HStack>
        <Text fontSize="2xs" color="fg.muted">
          {preview.row_count.toLocaleString()} rows · from {transform.source_tables.join(', ') || 'sheet'}
        </Text>
      </HStack>

      <Text fontSize="xs" color="fg.muted" mb={2}>{transform.description}</Text>

      {rows.length > 0 && (
        <Box overflowX="auto" borderRadius="sm" border="1px solid" borderColor="border.subtle">
          <Table.Root size="sm" aria-label={`Preview of ${transform.output_table}`}>
            <Table.Header>
              <Table.Row>
                {preview.columns.map(c => (
                  <Table.ColumnHeader key={c.name} fontSize="2xs" fontFamily="mono" whiteSpace="nowrap">
                    {c.name} <Span color="fg.subtle">{c.type.toLowerCase()}</Span>
                  </Table.ColumnHeader>
                ))}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((row, i) => (
                <Table.Row key={i}>
                  {preview.columns.map(c => (
                    <Table.Cell key={c.name} fontSize="2xs" fontFamily="mono" whiteSpace="nowrap">
                      {renderValue(row[c.name])}
                    </Table.Cell>
                  ))}
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Box>
      )}

      <Button
        aria-label={`Show SQL for ${transform.output_table}`}
        variant="ghost"
        size="2xs"
        mt={1.5}
        onClick={() => setShowSql(s => !s)}
      >
        {showSql ? 'Hide SQL' : 'Show SQL'}
      </Button>
      {showSql && (
        <Box as="pre" fontSize="2xs" fontFamily="mono" p={2} bg="bg.muted" borderRadius="sm" overflowX="auto" whiteSpace="pre-wrap">
          {transform.sql.trim()}
        </Box>
      )}
    </Box>
  );
}

export default function SheetImportReview({
  proposals, dropped, revising, confirming, confirmLabel = 'Import', onToggle, onRevise, onConfirm, onCancel,
}: SheetImportReviewProps) {
  const [feedback, setFeedback] = useState('');
  const includedCount = proposals.filter(p => p.included).length;

  return (
    <VStack gap={3} align="stretch" aria-label="Review proposed tables">
      <HStack gap={2}>
        <LuSparkles size={14} color="var(--chakra-colors-accent-teal)" />
        <Text fontSize="sm" fontWeight="700">
          The agent found {proposals.length} table{proposals.length === 1 ? '' : 's'} — review before importing
        </Text>
      </HStack>

      {dropped.length > 0 && (
        <HStack gap={1.5} align="flex-start">
          <LuTriangleAlert size={12} color="var(--chakra-colors-accent-warning)" style={{ marginTop: 2, flexShrink: 0 }} />
          <Text fontSize="2xs" color="accent.warning">
            Some proposed tables could not be made runnable and were skipped: {dropped.join('; ')}
          </Text>
        </HStack>
      )}

      {proposals.map(p => (
        <ProposalCard key={p.transform.output_table} proposal={p} onToggle={() => onToggle(p.transform.output_table)} />
      ))}

      <Box>
        <Textarea
          aria-label="Feedback for the agent"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder='Ask the agent to adjust anything — e.g. "split the % margin rows into their own table", "keep periods as columns instead of unpivoting"'
          fontSize="xs"
          rows={2}
        />
        <Button
          aria-label="Revise with agent"
          size="xs"
          variant="subtle"
          mt={1.5}
          disabled={!feedback.trim() || revising || confirming}
          loading={revising}
          onClick={() => { onRevise(feedback.trim()); setFeedback(''); }}
        >
          <LuSparkles size={12} /> Revise with agent
        </Button>
      </Box>

      <HStack gap={2}>
        <Button
          aria-label={`${confirmLabel} ${includedCount} tables`}
          size="sm"
          bg="accent.teal"
          disabled={includedCount === 0 || revising || confirming}
          loading={confirming}
          onClick={onConfirm}
        >
          <LuCheck size={14} /> {confirmLabel} {includedCount} table{includedCount === 1 ? '' : 's'}
        </Button>
        <Button aria-label="Cancel import review" size="sm" variant="ghost" disabled={confirming} onClick={onCancel}>
          Cancel
        </Button>
      </HStack>
    </VStack>
  );
}
