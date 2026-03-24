'use client';

/**
 * TransformationContainerV2
 * Smart component for transformation pages.
 */
import { Box } from '@chakra-ui/react';
import { useAppSelector } from '@/store/hooks';
import { selectMergedContent, selectEffectiveName, type FileId } from '@/store/filesSlice';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { editFile } from '@/lib/api/file-state';
import { useJobRuns } from '@/lib/hooks/job-runs-hooks';
import TransformationView from '@/components/views/TransformationView';
import type { TransformationContent } from '@/lib/types';
import { useCallback } from 'react';
import { type FileViewMode } from '@/lib/ui/fileComponents';

interface TransformationContainerV2Props {
  fileId: FileId;
  mode?: FileViewMode;
}

export default function TransformationContainerV2({ fileId }: TransformationContainerV2Props) {
  const { fileState: file } = useFile(fileId) ?? {};
  const fileLoading = !file || file.loading;
  const effectiveName = useAppSelector(state => selectEffectiveName(state, fileId)) || '';
  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId)) as TransformationContent | undefined;

  const numericId = typeof fileId === 'number' && fileId > 0 ? fileId : null;
  const { runs, isRunning, trigger } = useJobRuns(numericId, 'transformation');

  const handleChange = useCallback((updates: Partial<TransformationContent>) => {
    editFile({ fileId: typeof fileId === 'number' ? fileId : -1, changes: { content: updates } });
  }, [fileId]);

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
      runs={runs}
      onChange={handleChange}
      onRunNow={() => trigger()}
    />
  );
}
