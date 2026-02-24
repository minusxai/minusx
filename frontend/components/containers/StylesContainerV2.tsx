'use client';

/**
 * StylesContainer V2 - Phase 2 Implementation
 * Smart component for editing styles files (CSS editor)
 */
import { useAppSelector } from '@/store/hooks';
import { selectIsDirty, isVirtualFileId, type FileId } from '@/store/filesSlice';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { editFile, publishFile, reloadFile } from '@/lib/api/file-state';
import StylesEditor from '@/components/config/StylesEditor';
import { StylesContent } from '@/lib/types';
import { useMemo, useCallback } from 'react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { type FileViewMode } from '@/lib/ui/fileComponents';

interface StylesContainerV2Props {
  fileId: FileId;
  mode?: FileViewMode;
  defaultFolder?: string;
}

/**
 * Smart component for styles pages
 * Uses useFile hook for state management
 * Delegates rendering to StylesEditor
 */
export default function StylesContainerV2({
  fileId,
  mode = 'view',
  defaultFolder = '/configs',
}: StylesContainerV2Props) {
  const router = useRouter();

  // Use useFile hook for state management
  const { fileState: file } = useFile(fileId) ?? {};
  const fileLoading = !file || file.loading;
  const saving = file?.saving ?? false;
  const error = file?.loadError ?? null;
  const isDirty = useAppSelector(state => selectIsDirty(state, fileId));

  // Merge content with persistableChanges for preview
  const currentContent = useMemo(() => {
    if (!file) return null;
    return {
      ...file.content,
      ...file.persistableChanges
    } as StylesContent;
  }, [file]);

  // Save handler - uses save() from hook (handles both create and update)
  const handleSave = useCallback(async () => {
    if (!currentContent || typeof fileId !== 'number') return;

    try {
      const result = await publishFile({ fileId });

      // If this was a create operation, redirect to the new file
      if (result && isVirtualFileId(fileId)) {
        router.push(`/f/${result.id}`);
      }
    } catch (err) {
      console.error('Save failed:', err);
      throw err;
    }
  }, [currentContent, fileId, router]);

  // Show loading state while file is loading
  if (fileLoading || !file || !currentContent) {
    return <div>Loading styles...</div>;
  }

  // Handle changes from editor
  const handleChange = useCallback((updates: Partial<StylesContent>) => {
    if (currentContent) {
      editFile({ fileId: typeof fileId === 'number' ? fileId : -1, changes: { content: { ...currentContent, ...updates } as StylesContent } });
    }
  }, [fileId, currentContent]);

  const handleRevert = useCallback(() => {
    if (typeof fileId === 'number') {
      reloadFile({ fileId });
    }
  }, [fileId]);

  return (
    <StylesEditor
      content={currentContent}
      isDirty={isDirty}
      isSaving={saving}
      onChange={handleChange}
      onSave={handleSave}
      onRevert={handleRevert}
    />
  );
}
