'use client';

/**
 * ReportContainer V2
 * Smart component for report pages.
 * Uses the unified job runs system (useJobRuns) for execution and run history.
 */
import { Box } from '@chakra-ui/react';
import { useAppSelector } from '@/store/hooks';
import { selectMergedContent, selectEffectiveName, selectIsDirty, type FileId } from '@/store/filesSlice';
import { selectFileEditMode } from '@/store/uiSlice';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { useContext } from '@/lib/hooks/useContext';
import { editFile } from '@/lib/file-state/file-state';
import ReportView from '@/components/views/ReportView';
import { ReportContent, RunFileContent } from '@/lib/types';
import type { RunOptions } from '@/components/shared/RunNowHeader';
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
  const editMode = useAppSelector(state => selectFileEditMode(state, fileId));
  const isDirty = useAppSelector(state => selectIsDirty(state, fileId));
  const devMode = useAppSelector(state => state.ui.devMode);
  const colorMode = useAppSelector(state => state.ui.colorMode);

  // Context databases for the report's path — powers @-mention of tables/columns
  // in the instructions editor (questions/dashboards come from the server).
  const { databases } = useContext(file?.path || '/');

  // Unified job runs state — replaces the old reportRunsSlice and custom fetching
  const numericFileId = typeof fileId === 'number' && fileId >= 0 ? fileId : null;
  const { runs, selectedRunId, selectedRun, isRunning, trigger, selectRun } = useJobRuns(numericFileId, 'report');

  // Load the run file content for the currently selected run
  const runFileId = selectedRun?.output_file_id ?? undefined;
  const runFileAugmented = useFile(runFileId);
  const runFileContent = runFileAugmented?.fileState?.content as RunFileContent | undefined;

  const handleChange = useCallback((updates: Partial<ReportContent>) => {
    editFile({ fileId: typeof fileId === 'number' ? fileId : -1, changes: { content: updates } });
  }, [fileId]);

  const handleRunNow = useCallback(async (opts: RunOptions) => {
    await trigger(opts);
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
      showDevMarkers={devMode}
      colorMode={colorMode}
      report={mergedContent}
      fileId={fileId}
      isRunning={isRunning}
      runs={runs}
      selectedRunId={selectedRunId}
      runFileContent={runFileContent}
      runFileId={runFileId}
      whitelistedSchemas={databases}
      editMode={editMode}
      isDirty={isDirty}
      onChange={handleChange}
      onRunNow={handleRunNow}
      onSelectRun={handleSelectRun}
    />
  );
}
