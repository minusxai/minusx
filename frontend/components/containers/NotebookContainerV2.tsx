'use client';

/**
 * NotebookContainerV2 — smart component for notebook pages. Reads the notebook
 * file via useFile + selectMergedContent and persists cell edits through
 * editFile. Rendering is delegated to NotebookView (presentational).
 * Header (edit mode, save, cancel, name) is handled by FileHeader via FileView.
 */
import { useCallback } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectMergedContent, type FileId } from '@/store/filesSlice';
import { selectFileViewMode, selectNotebookActiveCell, setNotebookActiveCell } from '@/store/uiSlice';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { editFile } from '@/lib/api/file-state';
import NotebookView from '@/components/views/NotebookView';
import { NotebookContent } from '@/lib/types';
import { type FileViewMode } from '@/lib/ui/fileComponents';
import { selectEffectiveUser } from '@/store/authSlice';
import { canCreateFileByRole } from '@/lib/auth/access-rules.client';

interface NotebookContainerV2Props {
  fileId: FileId;
  mode?: FileViewMode;
}

export default function NotebookContainerV2({ fileId }: NotebookContainerV2Props) {
  const dispatch = useAppDispatch();
  const { fileState: file } = useFile(fileId) ?? {};
  const fileLoading = !file || file.loading;
  const numericId = typeof fileId === 'number' ? fileId : undefined;

  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId)) as NotebookContent | undefined;
  const viewMode = useAppSelector(state => selectFileViewMode(state, numericId));
  const activeCellId = useAppSelector(state => selectNotebookActiveCell(state, numericId));

  const effectiveUser = useAppSelector(selectEffectiveUser);
  const readOnly = !!effectiveUser && !!file && !canCreateFileByRole(effectiveUser.role, file.type as 'notebook');

  const handleChange = useCallback((updates: Partial<NotebookContent>) => {
    if (readOnly) return;
    editFile({ fileId, changes: { content: updates } });
  }, [fileId, readOnly]);

  const handleActivateCell = useCallback((cellId: string) => {
    if (numericId !== undefined) dispatch(setNotebookActiveCell({ fileId: numericId, cellId }));
  }, [dispatch, numericId]);

  if (fileLoading || !file || !mergedContent) {
    return <div>Loading notebook...</div>;
  }

  return (
    <NotebookView
      content={mergedContent}
      onChange={handleChange}
      readOnly={readOnly}
      filePath={file.path}
      fileId={numericId}
      viewMode={viewMode}
      activeCellId={activeCellId}
      onActivateCell={handleActivateCell}
    />
  );
}
