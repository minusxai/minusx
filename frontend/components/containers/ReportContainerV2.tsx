'use client';

/**
 * ReportContainer V2
 * Smart component for report pages.
 * Uses the unified job runs system (useJobRuns) for execution and run history.
 */
import { Box } from '@chakra-ui/react';
import { useAppSelector } from '@/store/hooks';
import { selectMergedContent, selectEffectiveName, type FileId } from '@/store/filesSlice';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { editFile } from '@/lib/api/file-state';
import ReportView from '@/components/views/ReportView';
import { ReportContent, ReportRunContent } from '@/lib/types';
import { useJobRuns } from '@/lib/hooks/job-runs-hooks';
import { useCallback } from 'react';
import { type FileViewMode } from '@/lib/ui/fileComponents';

interface ReportContainerV2Props {
  fileId: FileId;
  mode?: FileViewMode;
}

export default function ReportContainerV2({ fileId }: ReportContainerV2Props) {
  // File state
  const { fileState: file } = useFile(fileId) ?? {};
  const fileLoading = !file || file.loading;
  const effectiveName = useAppSelector(state => selectEffectiveName(state, fileId)) || '';
  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId)) as ReportContent | undefined;

  // Unified job runs state — replaces the old reportRunsSlice and custom fetching
  const numericFileId = typeof fileId === 'number' && fileId >= 0 ? fileId : null;
  const { runs, selectedRunId, selectedRun, isRunning, trigger, selectRun } = useJobRuns(numericFileId, 'report');

  // Load the run file content for the currently selected run
  const runFileId = selectedRun?.output_file_id ?? undefined;
  const runFileAugmented = useFile(runFileId);
  const reportRunContent = runFileAugmented?.fileState?.content as ReportRunContent | undefined;

  const handleChange = useCallback((updates: Partial<ReportContent>) => {
    editFile({ fileId: typeof fileId === 'number' ? fileId : -1, changes: { content: updates } });
  }, [fileId]);

  const handleRunNow = useCallback(async () => {
    await trigger();
  }, [trigger]);

  const handleSelectRun = useCallback((runId: number | null) => {
    selectRun(runId);
  }, [selectRun]);

  if (fileLoading || !file || !mergedContent) {
    return <Box p={4}>Loading report...</Box>;
  }

  if (typeof fileId !== 'number') return null;

  return (
    <ReportView
      report={mergedContent}
      fileId={fileId}
      isRunning={isRunning}
      runs={runs}
      selectedRunId={selectedRunId}
      reportRunContent={reportRunContent}
      onChange={handleChange}
      onRunNow={handleRunNow}
      onSelectRun={handleSelectRun}
    />
  );
}
