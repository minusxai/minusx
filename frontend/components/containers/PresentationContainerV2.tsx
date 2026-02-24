'use client';

/**
 * PresentationContainer V2 - Phase 2 Implementation
 * Smart component using Core Patterns with useFile hook and filesSlice
 *
 * Improvements over PresentationContainer:
 * - Uses useFile hook for state management
 * - Uses edit() for tracking changes
 * - Uses save() from hook (no manual fetch calls)
 * - Uses selectIsDirty for dirty detection
 * - Uses reload() for canceling changes
 * - Simplified, consistent state management
 */
import { useAppSelector } from '@/store/hooks';
import { selectIsDirty, type FileId } from '@/store/filesSlice';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { editFile, publishFile, reloadFile } from '@/lib/api/file-state';
import { redirectAfterSave } from '@/lib/ui/file-utils';
import PresentationView from '@/components/views/PresentationView';
import { DocumentContent } from '@/lib/types';
import { useMemo, useCallback, useState } from 'react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { isUserFacingError } from '@/lib/errors';
import { type FileViewMode } from '@/lib/ui/fileComponents';

interface PresentationContainerV2Props {
  fileId: FileId;
  mode?: FileViewMode;
}

/**
 * Smart component for presentation pages - Phase 2
 * Uses useFile hook for all state management
 * Delegates rendering to PresentationView (dumb component)
 */
export default function PresentationContainerV2({
  fileId,
  mode = 'view',
}: PresentationContainerV2Props) {
  const router = useRouter();

  // Phase 2: Use useFile hook for state management
  const { fileState: file } = useFile(fileId) ?? {};
  const fileLoading = !file || file.loading;
  const saving = file?.saving ?? false;
  const error = file?.loadError ?? null;
  const isDirty = useAppSelector(state => selectIsDirty(state, fileId));

  // Save error state (for user-facing errors)
  const [saveError, setSaveError] = useState<string | null>(null);

  // Edit mode state (controlled by container)
  const [editMode, setEditMode] = useState(mode === 'create');

  // Merge content with persistableChanges for preview
  const currentContent = useMemo(() => {
    if (!file) return null;
    return {
      ...file.content,
      ...file.persistableChanges
    } as DocumentContent;
  }, [file]);

  // Extract folder path from presentation path
  const folderPath = file?.path ? file.path.substring(0, file.path.lastIndexOf('/')) || '/' : '/';

  // Handlers
  const handleChange = useCallback((updates: Partial<DocumentContent>) => {
    editFile({ fileId: typeof fileId === 'number' ? fileId : -1, changes: { content: updates } });
  }, [fileId]);

  // Phase 2: Save handler - uses save() from hook (handles both create and update)
  const handleSave = useCallback(async () => {
    if (!currentContent || typeof fileId !== 'number') return;

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
      console.error('Failed to save presentation:', error);
      setSaveError('An unexpected error occurred. Please try again.');
    }
  }, [currentContent, fileId, router]);

  // Phase 2: Revert handler - uses reload() from hook
  const handleRevert = useCallback(() => {
    if (typeof fileId === 'number') {
      reloadFile({ fileId });
    }
  }, [fileId]);

  // Show loading state while file is loading
  if (fileLoading || !file || !currentContent) {
    return <div>Loading presentation...</div>;
  }

  return (
    <PresentationView
      document={currentContent}
      fileName={file.name}
      folderPath={folderPath}
      isDirty={isDirty}
      isSaving={saving}
      saveError={saveError}
      editMode={editMode}
      onChange={handleChange}
      onSave={handleSave}
      onRevert={handleRevert}
      onEditModeChange={setEditMode}
    />
  );
}
