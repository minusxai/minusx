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
import { useAppSelector } from '@/store/hooks';
import { selectMergedContent, type FileId } from '@/store/filesSlice';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { editFile } from '@/lib/api/file-state';
import DashboardView from '@/components/views/DashboardView';
import { DocumentContent } from '@/lib/types';
import { useCallback } from 'react';

interface DashboardContainerV2Props {
  fileId: FileId;
  mode?: 'view' | 'create';  // Handled by FileHeader (rendered by FileView)
}

/**
 * Smart component for dashboard pages - Phase 2
 * Uses useFile hook for all state management
 * Delegates rendering to DashboardView (dumb component)
 * Header (edit mode, save, cancel, name) is handled by FileHeader via FileView
 */
export default function DashboardContainerV2({ fileId }: DashboardContainerV2Props) {
  // Phase 2: Use useFile hook for state management
  const { fileState: file } = useFile(fileId) ?? {};
  const fileLoading = !file || file.loading;

  // Merge content with persistableChanges for preview
  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId)) as DocumentContent | undefined;

  // Extract folder path from dashboard path
  const folderPath = file?.path ? file.path.substring(0, file.path.lastIndexOf('/')) || '/' : '/';

  const handleChange = useCallback((updates: Partial<DocumentContent>) => {
    editFile({ fileId, changes: { content: updates } });
  }, [fileId]);

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
    />
  );
}
