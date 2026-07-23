'use client';

/**
 * AlertContainer V2
 * Smart component for alert pages.
 * All job run state and network calls are delegated to useJobRuns.
 */
import { useAppSelector } from '@/store/hooks';
import { selectMergedContent, selectEffectiveName, selectIsDirty, type FileId } from '@/store/filesSlice';
import { selectFileEditMode } from '@/store/uiSlice';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { editFile } from '@/lib/file-state/file-state';
import { useJobRuns } from '@/lib/hooks/job-runs-hooks';
import AlertView from '@/components/views/AlertView';
import type { AlertContent } from '@/lib/types';
import { useCallback } from 'react';
import { type FileViewMode } from '@/lib/ui/fileComponents';

interface AlertContainerV2Props {
  fileId: FileId;
  mode?: FileViewMode;
}

export default function AlertContainerV2({ fileId }: AlertContainerV2Props) {
  const { fileState: file } = useFile(fileId) ?? {};
  const fileLoading = !file || file.loading;
  const effectiveName = useAppSelector(state => selectEffectiveName(state, fileId)) || '';
  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId)) as AlertContent | undefined;
  const editMode = useAppSelector(state => selectFileEditMode(state, fileId));
  const isDirty = useAppSelector(state => selectIsDirty(state, fileId));

  const numericId = typeof fileId === 'number' && fileId > 0 ? fileId : null;
  const { runs, selectedRunId, isRunning, trigger, selectRun } = useJobRuns(numericId, 'alert');

  const handleChange = useCallback((updates: Partial<AlertContent>) => {
    editFile({ fileId: typeof fileId === 'number' ? fileId : -1, changes: { content: updates } });
  }, [fileId]);

  if (fileLoading || !file || !mergedContent) {
    return <div className="p-4">Loading alert...</div>;
  }

  if (typeof fileId !== 'number') return null;

  return (
    <AlertView
      alert={mergedContent}
      alertName={effectiveName}
      isRunning={isRunning}
      runs={runs}
      selectedRunId={selectedRunId}
      editMode={editMode}
      isDirty={isDirty}
      onChange={handleChange}
      onRunNow={(options) => trigger(options)}
      onSelectRun={selectRun}
    />
  );
}
