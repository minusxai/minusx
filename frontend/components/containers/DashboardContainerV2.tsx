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
 */
import { Box } from '@chakra-ui/react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { selectIsDirty, selectMergedContent, selectEffectiveName, type FileId } from '@/store/filesSlice';
import { selectDashboardEditMode, setDashboardEditMode, setRightSidebarCollapsed, setActiveSidebarSection } from '@/store/uiSlice';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { editFile, publishFile, clearFileChanges } from '@/lib/api/file-state';
import { redirectAfterSave } from '@/lib/ui/file-utils';
import DashboardView from '@/components/views/DashboardView';
import { DocumentContent } from '@/lib/types';
import { useCallback, useState, useEffect } from 'react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { isUserFacingError } from '@/lib/errors';

interface DashboardContainerV2Props {
  fileId: FileId;
  mode?: 'view' | 'create';
}

/**
 * Smart component for dashboard pages - Phase 2
 * Uses useFile hook for all state management
 * Delegates rendering to DashboardView (dumb component)
 */
export default function DashboardContainerV2({
  fileId,
  mode = 'view',
}: DashboardContainerV2Props) {
  const router = useRouter();
  const dispatch = useAppDispatch();

  // Phase 2: Use useFile hook for state management
  const file = useFile(fileId);
  const fileLoading = !file || file.loading;
  const saving = file?.saving ?? false;
  const isDirty = useAppSelector(state => selectIsDirty(state, fileId));
  const effectiveName = useAppSelector(state => selectEffectiveName(state, fileId)) || '';

  // Save error state (for user-facing errors)
  const [saveError, setSaveError] = useState<string | null>(null);

  // Edit mode state (from Redux)
  const editMode = useAppSelector(state => selectDashboardEditMode(state, fileId));

  // Initialize edit mode for create mode
  useEffect(() => {
    if (mode === 'create' && !editMode) {
      dispatch(setDashboardEditMode({ fileId, editMode: true }));
    }
  }, [mode, fileId, dispatch, editMode]);

  // Auto-enter edit mode when changes are made (e.g., by agent)
  useEffect(() => {
    if (isDirty && !editMode) {
      dispatch(setDashboardEditMode({ fileId, editMode: true }));
    }
  }, [isDirty, editMode, fileId, dispatch]);

  // Merge content with persistableChanges for preview
  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId)) as DocumentContent | undefined;

  // Extract folder path from dashboard path
  const folderPath = file?.path ? file.path.substring(0, file.path.lastIndexOf('/')) || '/' : '/';

  // Handlers
  const handleChange = useCallback((updates: Partial<DocumentContent>) => {
    editFile({ fileId, changes: { content: updates } });
  }, [fileId]);

  // Phase 5: Metadata change handler
  const handleMetadataChange = useCallback((changes: { name?: string }) => {
    editFile({ fileId, changes });
  }, [fileId]);

  // Phase 3: Save handler - uses publishFile from file-state.ts (handles both create and update)
  const handleSave = useCallback(async () => {
    if (!mergedContent) return;

    // Clear previous save error
    setSaveError(null);

    try {
      const result = await publishFile({ fileId });
      redirectAfterSave(result, fileId, router);
    } catch (error) {
      // User-facing errors should be shown in UI
      if (isUserFacingError(error)) {
        setSaveError(error.message);
        return; // Don't re-throw
      }

      // Internal errors should be logged
      console.error('Failed to save dashboard:', error);
      setSaveError('An unexpected error occurred. Please try again.');
    }
  }, [mergedContent, fileId, router]);

  // Phase 2: Revert handler - discard local changes without reloading
  const handleRevert = useCallback(() => {
    clearFileChanges({ fileId });
    dispatch(setDashboardEditMode({ fileId, editMode: false }));
    setSaveError(null);
  }, [fileId, dispatch]);

  // Handler for edit mode changes from view
  const handleEditModeChange = useCallback((newEditMode: boolean) => {
    dispatch(setDashboardEditMode({ fileId, editMode: newEditMode }));
  }, [dispatch, fileId]);

  // Show loading state while file is loading
  if (fileLoading || !file || !mergedContent) {
    return <div>Loading dashboard...</div>;
  }

  return (
    <DashboardView
      document={mergedContent}
      fileName={effectiveName}
      folderPath={folderPath}
      isDirty={isDirty}
      isSaving={saving}
      saveError={saveError}
      fileId={fileId}
      editMode={editMode}
      onChange={handleChange}
      onMetadataChange={handleMetadataChange}
      onSave={handleSave}
      onRevert={handleRevert}
      onEditModeChange={handleEditModeChange}
    />
  );
}
