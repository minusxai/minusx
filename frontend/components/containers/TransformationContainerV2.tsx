'use client';

/**
 * TransformationContainerV2
 * Smart component for transformation pages.
 */
import { Box } from '@chakra-ui/react';
import { useAppSelector } from '@/store/hooks';
import { selectMergedContent, selectEffectiveName, type FileId } from '@/store/filesSlice';
import { setFiles } from '@/store/filesSlice';
import { useAppDispatch } from '@/store/hooks';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { editFile } from '@/lib/api/file-state';
import { useJobRuns } from '@/lib/hooks/job-runs-hooks';
import TransformationView from '@/components/views/TransformationView';
import type { TransformationContent } from '@/lib/types';
import { useCallback, useState } from 'react';
import { type FileViewMode } from '@/lib/ui/fileComponents';

interface TransformationContainerV2Props {
  fileId: FileId;
  mode?: FileViewMode;
}

export default function TransformationContainerV2({ fileId }: TransformationContainerV2Props) {
  const dispatch = useAppDispatch();
  const { fileState: file } = useFile(fileId) ?? {};
  const fileLoading = !file || file.loading;
  const effectiveName = useAppSelector(state => selectEffectiveName(state, fileId)) || '';
  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId)) as TransformationContent | undefined;
  const numericId = typeof fileId === 'number' && fileId > 0 ? fileId : null;
  const { runs, selectedRunId, isRunning, trigger, selectRun } = useJobRuns(numericId, 'transformation');

  const [schemaRefreshing, setSchemaRefreshing] = useState(false);

  const handleChange = useCallback((updates: Partial<TransformationContent>) => {
    editFile({ fileId: typeof fileId === 'number' ? fileId : -1, changes: { content: updates } });
  }, [fileId]);

  const connectionIds = useAppSelector(state =>
    Object.values(state.files.files)
      .filter(f => f.type === 'connection' && f.id > 0)
      .map(f => f.id as number)
  );

  const handleRunNow = useCallback(async (runMode?: 'full' | 'test_only') => {
    await trigger({ run_mode: runMode });
    // Refresh connection schemas client-side after run completes
    setSchemaRefreshing(true);
    try {
      const refreshed = await Promise.all(
        connectionIds.map(id =>
          fetch(`/api/files/${id}?refresh=true`).then(r => r.ok ? r.json() : null)
        )
      );
      const files = refreshed.flatMap(r => r?.data ? [r.data] : []);
      if (files.length > 0) dispatch(setFiles({ files }));
    } catch (err) {
      console.error('[TransformationContainer] Schema refresh failed:', err);
    } finally {
      setSchemaRefreshing(false);
    }
  }, [trigger, connectionIds, dispatch]);

  if (fileLoading || !file || !mergedContent) {
    return <Box p={4}>Loading transformation...</Box>;
  }

  if (typeof fileId !== 'number') return null;

  return (
    <TransformationView
      transformation={mergedContent}
      transformationName={effectiveName}
      fileId={fileId}
      isRunning={isRunning}
      schemaRefreshing={schemaRefreshing}
      runs={runs}
      selectedRunId={selectedRunId}
      onChange={handleChange}
      onRunNow={handleRunNow}
      onSelectRun={selectRun}
    />
  );
}
