'use client';

/**
 * TransformationContainerV2
 * Smart component for transformation pages.
 */
import { Box } from '@chakra-ui/react';
import { useAppSelector } from '@/store/hooks';
import { shallowEqual } from 'react-redux';
import { selectMergedContent, selectEffectiveName, selectConnectionIds, selectIsDirty, type FileId } from '@/store/filesSlice';
import { setFiles } from '@/store/filesSlice';
import { selectFileEditMode } from '@/store/uiSlice';
import { useAppDispatch } from '@/store/hooks';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { useContext } from '@/lib/hooks/useContext';
import { editFile } from '@/lib/file-state/file-state';
import { FilesAPI } from '@/lib/data/files';
import { useJobRuns } from '@/lib/hooks/job-runs-hooks';
import TransformationView from '@/components/views/TransformationView';
import type { TransformationContent } from '@/lib/types';
import type { RunOptions } from '@/components/shared/RunNowHeader';
import { useCallback, useMemo, useState } from 'react';
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
  const editMode = useAppSelector(state => selectFileEditMode(state, fileId));
  const isDirty = useAppSelector(state => selectIsDirty(state, fileId));
  const numericId = typeof fileId === 'number' && fileId > 0 ? fileId : null;
  const { runs, selectedRunId, isRunning, trigger, selectRun } = useJobRuns(numericId, 'transformation');

  // shallowEqual: avoid re-rendering when Immer rotates the bag ref but no entry changed.
  const files = useAppSelector(state => state.files.files, shallowEqual);
  const questions = useMemo(() =>
    Object.values(files).filter(f => f.type === 'question' && f.id > 0),
    [files]
  );
  const filePath = useAppSelector(state => state.files.files[fileId]?.path) ?? '';
  const { databases } = useContext(filePath);

  const [schemaRefreshing, setSchemaRefreshing] = useState(false);

  const handleChange = useCallback((updates: Partial<TransformationContent>) => {
    editFile({ fileId: typeof fileId === 'number' ? fileId : -1, changes: { content: updates } });
  }, [fileId]);

  const connectionIds = useAppSelector(selectConnectionIds, shallowEqual);

  const handleRunNow = useCallback(async (opts: RunOptions) => {
    await trigger({ run_mode: 'full', ...opts });
    // Refresh connection schemas client-side after run completes
    setSchemaRefreshing(true);
    try {
      const refreshed = await Promise.allSettled(
        connectionIds.map(id => FilesAPI.loadFile(id, undefined, { refresh: true }))
      );
      const files = refreshed.flatMap(r => r.status === 'fulfilled' ? [r.value.data] : []);
      if (files.length > 0) dispatch(setFiles({ files }));
    } catch (err) {
      console.error('[TransformationContainer] Schema refresh failed:', err);
    } finally {
      setSchemaRefreshing(false);
    }
  }, [trigger, connectionIds, dispatch]);

  const handleTestOnly = useCallback(async (opts: RunOptions) => {
    await trigger({ run_mode: 'test_only', ...opts });
  }, [trigger]);

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
      editMode={!!editMode}
      isDirty={isDirty}
      questions={questions}
      databases={databases}
      onChange={handleChange}
      onRunNow={handleRunNow}
      onTestOnly={handleTestOnly}
      onSelectRun={selectRun}
    />
  );
}
