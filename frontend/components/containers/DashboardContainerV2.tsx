'use client';

/**
 * DashboardContainer V2 - Phase 2 Implementation
 * Smart component using Core Patterns with useFile hook and filesSlice
 *
 * Improvements over DashboardContainer:
 * - Uses useFile hook for state management
 * - Uses edit() for tracking changes
 * - Uses save() from hook (no manual fetch calls)
 * - Uses selectIsDirty for dirty detection
 * - Uses reload() for canceling changes
 * - Simplified, consistent state management
 *
 * Owns all Redux access for the dashboard visual surface (Container/View convention,
 * CLAUDE.md "Component Patterns") — DashboardView is pure presentation and receives
 * everything (values + callbacks) as props.
 */
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import {
  selectMergedContent, selectIsDirty, selectDirtyFiles, setEphemeral,
  addQuestionToDashboard, addTextBlockToDashboard, updateTextBlockContent,
  type FileId,
} from '@/store/filesSlice';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { editFile } from '@/lib/file-state/file-state';
import { pushView, selectFileEditMode } from '@/store/uiSlice';
import DashboardView from '@/components/views/DashboardView';
import { DocumentContent, QuestionContent } from '@/lib/types';
import { useCallback } from 'react';
import { type FileViewMode } from '@/lib/ui/fileComponents';
import { selectEffectiveUser } from '@/store/authSlice';
import { canCreateFileByRole } from '@/lib/auth/access-rules.client';
import { shallowEqual } from 'react-redux';

// NOTE: a stable module-level fallback (not a fresh {} each render) — a new {} each
// render would make DashboardView's derived values (e.g. effectiveSubmittedValues)
// unstable, cascading into infinite retry loops downstream. See DashboardView.tsx.
const EMPTY_PARAMS: Record<string, any> = {};

interface DashboardContainerV2Props {
  fileId: FileId;
  mode?: FileViewMode;
}

/**
 * Smart component for dashboard pages - Phase 2
 * Uses useFile hook for all state management
 * Delegates rendering to DashboardView (dumb component)
 * Header (edit mode, save, cancel, name) is handled by FileHeader via FileView
 */
export default function DashboardContainerV2({ fileId, mode }: DashboardContainerV2Props) {
  const dispatch = useAppDispatch();

  // Phase 2: Use useFile hook for state management
  const { fileState: file } = useFile(fileId) ?? {};
  const fileLoading = !file || file.loading;

  // Merge content with persistableChanges for preview
  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId)) as DocumentContent | undefined;

  // Extract folder path from dashboard path
  const folderPath = file?.path ? file.path.substring(0, file.path.lastIndexOf('/')) || '/' : '/';

  // Derive readOnly from the user's role — prevents persistable changes for non-editors
  const effectiveUser = useAppSelector(selectEffectiveUser);
  const readOnly = !!effectiveUser && !!file && !canCreateFileByRole(effectiveUser.role, file.type as 'dashboard');

  // editMode sourced from Redux (managed by FileHeader), combined with mode/readOnly override.
  // The JSON/XML "Code view" is rendered centrally by FileView — DashboardView only renders
  // the visual surface.
  const reduxEditMode = useAppSelector(state => selectFileEditMode(state, fileId));
  const editMode = (mode === 'preview' || readOnly) ? false : reduxEditMode;

  // Force react-grid-layout to remount when file reverts from dirty -> clean (discard/save) — see DashboardView.
  const isDirty = useAppSelector(state => selectIsDirty(state, fileId));

  // Dashboard-level persisted parameterValues (fallback for the filter row until something's submitted).
  const paramValues = mergedContent?.parameterValues || EMPTY_PARAMS;

  // Last-submitted param values from lastExecuted (gates execution).
  const lastExecutedParams = useAppSelector(
    state => (state.files.files[fileId]?.ephemeralChanges as any)?.lastExecuted?.params as Record<string, any> | undefined
  ) ?? EMPTY_PARAMS;

  // Extract question IDs from assets (for the per-question merged content lookup below).
  const questionIds = mergedContent?.assets
    ?.filter(asset => asset.type === 'question' && ('id' in asset) && asset.id)
    ?.map(asset => (asset as { type: 'question'; id: number }).id) || [];

  // Get all question contents (memoized with shallowEqual to prevent re-renders)
  const questionContents = useAppSelector(
    state => questionIds.map(id => selectMergedContent(state, id) as QuestionContent | undefined),
    shallowEqual
  );

  // Publish/edit highlight source data: fileState (persistableChanges diff) + dirtyFiles (child edits).
  const fileState = useAppSelector(state => state.files.files[fileId]);
  const dirtyFiles = useAppSelector(selectDirtyFiles, shallowEqual);

  const handleChange = useCallback((updates: Partial<DocumentContent>) => {
    if (readOnly) return;
    editFile({ fileId, changes: { content: updates } });
  }, [fileId, readOnly]);

  // Stable across renders so React.memo(TextBlockCard) can skip unaffected blocks.
  const onTextBlockContentChange = useCallback((textBlockId: string, content: string) => {
    dispatch(updateTextBlockContent({ dashboardId: fileId, textBlockId, content }));
  }, [dispatch, fileId]);

  const onQuestionEdit = useCallback((questionId: number, dashboardParamValues: Record<string, any>) => {
    dispatch(pushView({ type: 'question', fileId: questionId, dashboardId: fileId, dashboardParamValues }));
  }, [dispatch, fileId]);

  const onParamSubmit = useCallback((newParamValues: Record<string, any>) => {
    // Update lastExecuted.params to trigger execution
    dispatch(setEphemeral({
      fileId,
      changes: {
        lastExecuted: { query: '', params: newParamValues, database: '' }
      }
    }));
    // In edit mode: persist to dirty state (saveable with Update)
    // Outside edit mode: ephemeral only (no dirty, no save needed)
    if (editMode) {
      editFile({ fileId, changes: { content: { parameterValues: newParamValues } } });
    }
  }, [dispatch, fileId, editMode]);

  const onAddQuestion = useCallback((questionId: number) => {
    dispatch(addQuestionToDashboard({ dashboardId: fileId, questionId }));
  }, [dispatch, fileId]);

  const onAddTextBlock = useCallback(() => {
    dispatch(addTextBlockToDashboard({ dashboardId: fileId }));
  }, [dispatch, fileId]);

  // Show loading state while file is loading
  if (fileLoading || !file || !mergedContent) {
    return <div>Loading dashboard...</div>;
  }

  // DashboardView requires a numeric fileId
  if (typeof fileId !== 'number') return null;

  return (
    <DashboardView
      document={mergedContent}
      folderPath={folderPath}
      fileId={fileId}
      onChange={handleChange}
      editMode={editMode}
      isDirty={isDirty}
      paramValues={paramValues}
      lastExecutedParams={lastExecutedParams}
      questionContents={questionContents}
      fileState={fileState}
      dirtyFiles={dirtyFiles}
      onTextBlockContentChange={onTextBlockContentChange}
      onQuestionEdit={onQuestionEdit}
      onParamSubmit={onParamSubmit}
      onAddQuestion={onAddQuestion}
      onAddTextBlock={onAddTextBlock}
    />
  );
}
