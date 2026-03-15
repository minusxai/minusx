'use client';

/**
 * AlertContainer V2
 * Smart component for alert pages.
 * Delegates query execution and run creation to /api/jobs/run (server-side).
 */
import { Box } from '@chakra-ui/react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectMergedContent, selectEffectiveName, type FileId } from '@/store/filesSlice';
import { setRuns, setSelectedRun, selectAlertRuns, selectSelectedAlertRunId } from '@/store/alertRunsSlice';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { editFile } from '@/lib/api/file-state';
import AlertView from '@/components/views/AlertView';
import { AlertContent, JobRun } from '@/lib/types';
import { useCallback, useState, useEffect } from 'react';
import { type FileViewMode } from '@/lib/ui/fileComponents';

interface AlertContainerV2Props {
  fileId: FileId;
  mode?: FileViewMode;
}

export default function AlertContainerV2({ fileId }: AlertContainerV2Props) {
  const dispatch = useAppDispatch();

  const { fileState: file } = useFile(fileId) ?? {};
  const fileLoading = !file || file.loading;
  const effectiveName = useAppSelector(state => selectEffectiveName(state, fileId)) || '';

  // Alert runs from Redux
  const runs = useAppSelector(state => selectAlertRuns(state, typeof fileId === 'number' ? fileId : -1));
  const selectedRunId = useAppSelector(state => selectSelectedAlertRunId(state, typeof fileId === 'number' ? fileId : -1));

  const [isRunning, setIsRunning] = useState(false);

  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId)) as AlertContent | undefined;

  // Fetch past runs from job_runs table via API
  const loadRuns = useCallback(async (selectLatest = false) => {
    if (typeof fileId !== 'number' || fileId < 0) {
      dispatch(setRuns({ alertId: fileId as number, runs: [] }));
      return;
    }

    try {
      const response = await fetch(`/api/jobs/runs?job_id=${fileId}&job_type=alert&limit=20`);
      if (!response.ok) throw new Error('Failed to load runs');
      const result = await response.json();
      const jobRuns: JobRun[] = result.data || [];

      dispatch(setRuns({ alertId: fileId, runs: jobRuns }));

      if (selectLatest && jobRuns.length > 0) {
        dispatch(setSelectedRun({ alertId: fileId, runId: jobRuns[0].id }));
      }
    } catch (error) {
      console.error('Error loading alert runs:', error);
    }
  }, [fileId, dispatch]);

  // Load runs when fileId changes - auto-select latest
  useEffect(() => {
    loadRuns(true);
  }, [loadRuns]);

  // Handlers
  const handleChange = useCallback((updates: Partial<AlertContent>) => {
    editFile({ fileId: typeof fileId === 'number' ? fileId : -1, changes: { content: updates } });
  }, [fileId]);

  // Check Now handler - delegates to server-side /api/jobs/run
  const handleCheckNow = useCallback(async () => {
    if (isRunning || !file || typeof fileId !== 'number' || fileId < 0 || !mergedContent) return;
    if (!mergedContent.questionId || mergedContent.questionId <= 0) return;

    setIsRunning(true);
    try {
      const response = await fetch('/api/jobs/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: String(fileId), job_type: 'alert' }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Check failed');
      }
      await loadRuns(true);
    } catch (error) {
      console.error('Alert check failed:', error);
      await loadRuns(true);
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, file, fileId, mergedContent, loadRuns]);

  const handleSelectRun = useCallback((runId: number | null) => {
    if (typeof fileId === 'number' && fileId >= 0) {
      dispatch(setSelectedRun({ alertId: fileId, runId }));
    }
  }, [fileId, dispatch]);

  if (fileLoading || !file || !mergedContent) {
    return <Box p={4}>Loading alert...</Box>;
  }

  if (typeof fileId !== 'number') return null;

  return (
    <AlertView
      alert={mergedContent}
      alertName={effectiveName}
      fileId={fileId}
      isRunning={isRunning}
      runs={runs}
      selectedRunId={selectedRunId}
      onChange={handleChange}
      onCheckNow={handleCheckNow}
      onSelectRun={handleSelectRun}
    />
  );
}
