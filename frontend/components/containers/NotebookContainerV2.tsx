'use client';

/**
 * NotebookContainerV2 — smart component for notebook pages. Reads the notebook
 * file via useFile + selectMergedContent and persists cell edits through
 * editFile. Rendering is delegated to NotebookView (presentational).
 * Header (edit mode, save, cancel, name) is handled by FileHeader via FileView.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectMergedContent, selectNotebookCellExecuted, setNotebookCellExecuted, type FileId } from '@/store/filesSlice';
import { selectNotebookActiveCell, selectVizV2Active, setNotebookActiveCell } from '@/store/uiSlice';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { editFile, getQueryResult } from '@/lib/file-state/file-state';
import { clearQueryResult } from '@/store/queryResultsSlice';
import { buildQueryParamValues } from '@/lib/sql/sql-params';
import NotebookView from '@/components/views/NotebookView';
import type { Executed } from '@/components/views/notebook/NotebookSqlCell';
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
  const activeCellId = useAppSelector(state => selectNotebookActiveCell(state, numericId));
  const reduxExecuted = useAppSelector(state =>
    numericId !== undefined ? selectNotebookCellExecuted(state, numericId) : undefined
  );

  const effectiveUser = useAppSelector(selectEffectiveUser);
  const devMode = useAppSelector(state => state.ui.devMode);
  const colorMode = useAppSelector(state => state.ui.colorMode);
  const vizV2Enabled = useAppSelector(selectVizV2Active);
  const readOnly = !!effectiveUser && !!file && !canCreateFileByRole(effectiveUser.role, file.type as 'notebook');

  const handleChange = useCallback((updates: Partial<NotebookContent>) => {
    if (readOnly) return;
    editFile({ fileId, changes: { content: updates } });
  }, [fileId, readOnly]);

  const handleActivateCell = useCallback((cellId: string) => {
    if (numericId !== undefined) dispatch(setNotebookActiveCell({ fileId: numericId, cellId }));
  }, [dispatch, numericId]);

  const handleReduxExecutedChange = useCallback((cellId: string, executed: Executed) => {
    if (numericId === undefined) return;
    const cell = mergedContent?.cells.find(c => c.type === 'sql' && c.id === cellId);
    if (!cell || cell.type !== 'sql') return;
    const normalized = {
      ...executed,
      params: buildQueryParamValues(cell.parameters ?? [], executed.params, {}),
    };
    dispatch(clearQueryResult(normalized));
    dispatch(setNotebookCellExecuted({ fileId: numericId, cellId, executed: normalized }));
    // A cell Run is deliberate, matching a question page's forced refresh. The
    // cell's useQueryResult effect deduplicates onto this same in-flight request.
    getQueryResult({ ...normalized, filePath: file?.path }, { forceLoad: true }).catch(() => {});
  }, [dispatch, numericId, mergedContent, file?.path]);

  // Match standalone questions: existing files execute their current source once
  // per mount through the shared query cache; result rows are never file content.
  // Keep an existing cellExecuted entry while the user edits, so old results stay
  // visible until the next explicit Run. If Cancel clears ephemerals, restore it.
  const initializedRef = useRef<{ fileId: FileId; cellIds: Set<string> } | null>(null);
  useEffect(() => {
    if (numericId === undefined || fileLoading || !mergedContent || file?.draft) return;
    const firstForFile = initializedRef.current?.fileId !== numericId;
    if (firstForFile) {
      initializedRef.current = {
        fileId: numericId,
        cellIds: new Set(mergedContent.cells
          .filter(cell => cell.type === 'sql' && !!cell.query && !!cell.connection_name)
          .map(cell => cell.id)),
      };
    }
    const mountCellIds = initializedRef.current!.cellIds;
    for (const cell of mergedContent.cells) {
      if (cell.type !== 'sql' || !cell.query || !cell.connection_name) continue;
      // A cell added interactively after mount follows the draft-question rule:
      // wait for an explicit Run. Agent-added cells are executed by EditFile.
      if (!mountCellIds.has(cell.id)) continue;
      if (!firstForFile && reduxExecuted?.[cell.id]) continue;
      const params = buildQueryParamValues(cell.parameters ?? [], cell.parameterValues ?? {}, {});
      dispatch(setNotebookCellExecuted({
        fileId: numericId,
        cellId: cell.id,
        executed: { query: cell.query, params, database: cell.connection_name },
      }));
    }
  }, [numericId, fileLoading, mergedContent, file?.draft, reduxExecuted, dispatch]);

  if (fileLoading || !file || !mergedContent) {
    return <div>Loading notebook...</div>;
  }

  return (
    <NotebookView
      showDevMarkers={devMode}
      colorMode={colorMode}
      content={mergedContent}
      onChange={handleChange}
      readOnly={readOnly}
      vizV2Enabled={vizV2Enabled}
      filePath={file.path}
      fileId={numericId}
      activeCellId={activeCellId}
      onActivateCell={handleActivateCell}
      reduxExecuted={reduxExecuted}
      onReduxExecutedChange={handleReduxExecutedChange}
    />
  );
}
