'use client';

/**
 * "Adjust with agent" — post-import revision of an agentically-imported spreadsheet group.
 *
 * Opening the dialog re-downloads the live sheet, re-extracts raw grids, and previews the
 * STORED transforms against the fresh data (no LLM call). From there the user drives the same
 * review loop as a first import: exclude tables, send feedback to the agent, and Apply —
 * which materializes the accepted transforms, replaces the group's tables in the connection
 * config, and queues the old blobs for deletion when the connection is saved. Cancel discards
 * the transient raw grids.
 */

import { useState, useEffect, useRef } from 'react';
import { Dialog, Portal, Spinner, HStack, Text, VStack } from '@chakra-ui/react';
import { LuSparkles } from 'react-icons/lu';
import { CsvFileInfo } from '@/lib/types';
import {
  prepareGoogleSheetAdjustment,
  reviseGoogleSheetTransforms,
  confirmGoogleSheetImport,
  discardGoogleSheetRawGrids,
  type SheetAnalysisResult,
} from '@/lib/connections/client/google-sheets';
import SheetImportReview, { type SheetImportProposal } from './SheetImportReview';
import type { BaseConfigProps } from './types';

export interface SheetAdjustDialogProps {
  open: boolean;
  connectionName: string;
  /** The agentic spreadsheet group being adjusted (every file carries its transform). */
  groupFiles: CsvFileInfo[];
  existingFiles: CsvFileInfo[];
  onChange: BaseConfigProps['onChange'];
  onError: (error: string) => void;
  /** Queue an old blob for deletion when the connection is saved. */
  onPendingDeletion: (s3Key: string) => void;
  onClose: () => void;
}

type Phase = 'preparing' | 'review' | 'revising' | 'confirming';

export default function SheetAdjustDialog({
  open, connectionName, groupFiles, existingFiles, onChange, onError, onPendingDeletion, onClose,
}: SheetAdjustDialogProps) {
  const [phase, setPhase] = useState<Phase>('preparing');
  const [analysis, setAnalysis] = useState<SheetAnalysisResult | null>(null);
  const [proposals, setProposals] = useState<SheetImportProposal[]>([]);
  const [dropped, setDropped] = useState<string[]>([]);
  const preparedForRef = useRef<string | null>(null);

  const spreadsheetUrl = groupFiles[0]?.spreadsheet_url ?? '';
  const spreadsheetId = groupFiles[0]?.spreadsheet_id ?? '';

  useEffect(() => {
    if (!open || !spreadsheetUrl) return;
    if (preparedForRef.current === spreadsheetId) return;
    preparedForRef.current = spreadsheetId;

    const storedTransforms = groupFiles.map((f) => f.transform).filter((t) => t != null);
    setPhase('preparing');
    setAnalysis(null);
    setProposals([]);
    setDropped([]);

    prepareGoogleSheetAdjustment(connectionName, spreadsheetUrl, storedTransforms).then((result) => {
      if (!result.success) {
        onError(result.message);
        preparedForRef.current = null;
        onClose();
        return;
      }
      setAnalysis(result.data);
      setProposals(result.data.transforms.map((t) => ({
        transform: t,
        preview: result.data.previews[t.output_table],
        included: true,
      })));
      setDropped(result.data.dropped);
      setPhase('review');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, spreadsheetId]);

  const handleToggle = (outputTable: string) => {
    setProposals((prev) => prev.map((p) =>
      p.transform.output_table === outputTable ? { ...p, included: !p.included } : p,
    ));
  };

  const handleRevise = async (feedback: string) => {
    if (!analysis) return;
    setPhase('revising');
    const result = await reviseGoogleSheetTransforms(
      connectionName, analysis.raw_files, proposals.map((p) => p.transform), feedback,
    );
    if (!result.success) { onError(result.message); setPhase('review'); return; }
    const includedByTable = new Map(proposals.map((p) => [p.transform.output_table, p.included]));
    setProposals(result.data.transforms.map((t) => ({
      transform: t,
      preview: result.data.previews[t.output_table],
      included: includedByTable.get(t.output_table) ?? true,
    })));
    setDropped(result.data.dropped);
    setPhase('review');
  };

  const handleConfirm = async () => {
    if (!analysis) return;
    const accepted = proposals.filter((p) => p.included).map((p) => p.transform);
    if (accepted.length === 0) return;
    setPhase('confirming');
    const result = await confirmGoogleSheetImport(connectionName, spreadsheetUrl, analysis.raw_files, accepted);
    if (!result.success) { onError(result.message); setPhase('review'); return; }

    // Replace the group in place; everything else in the connection is untouched. Old blobs
    // are queued for deletion at save time — Save Connection stays the single commit point.
    const groupKeys = new Set(groupFiles.map((f) => f.s3_key));
    onChange({ files: [...result.data.files, ...existingFiles.filter((f) => !groupKeys.has(f.s3_key))] });
    groupFiles.forEach((f) => onPendingDeletion(f.s3_key));
    preparedForRef.current = null;
    onClose();
  };

  const handleCancel = () => {
    // Raw grids are transient — clean them up (best-effort) when the wizard is abandoned.
    if (analysis) void discardGoogleSheetRawGrids(connectionName, analysis.raw_files);
    preparedForRef.current = null;
    onClose();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(e) => { if (!e.open) handleCancel(); }} size="xl" scrollBehavior="inside">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content aria-label="Adjust imported tables">
            <Dialog.Header>
              <HStack gap={2}>
                <LuSparkles size={16} color="var(--chakra-colors-accent-teal)" />
                <Dialog.Title fontSize="md">Adjust imported tables</Dialog.Title>
              </HStack>
            </Dialog.Header>
            <Dialog.Body>
              {phase === 'preparing' ? (
                <VStack py={8} gap={3}>
                  <Spinner color="accent.teal" />
                  <Text fontSize="xs" color="fg.muted">
                    Fetching the live sheet and re-running your current transforms…
                  </Text>
                </VStack>
              ) : (
                <SheetImportReview
                  proposals={proposals}
                  dropped={dropped}
                  revising={phase === 'revising'}
                  confirming={phase === 'confirming'}
                  confirmLabel="Apply"
                  onToggle={handleToggle}
                  onRevise={handleRevise}
                  onConfirm={handleConfirm}
                  onCancel={handleCancel}
                />
              )}
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
