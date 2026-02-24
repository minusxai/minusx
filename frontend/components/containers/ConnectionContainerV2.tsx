'use client';

/**
 * ConnectionContainer V2 - Phase 2 Implementation
 * Smart component using Core Patterns with useFile hook and filesSlice
 *
 * Hybrid API approach for connections:
 * - CREATE: POST /api/connections → initializes Python backend + creates document
 * - UPDATE: PATCH /api/files/[id] → updates document only (Phase 2 pattern)
 * - DELETE: DELETE /api/connections/[name] → cleans up Python + document
 */
import { useAppSelector } from '@/store/hooks';
import { selectIsDirty, selectEffectiveName, type FileId } from '@/store/filesSlice';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { editFile, publishFile, reloadFile } from '@/lib/api/file-state';
import { redirectAfterSave } from '@/lib/ui/file-utils';
import ConnectionFormV2 from '@/components/views/ConnectionFormV2';
import { ConnectionContent } from '@/lib/types';
import { useCallback, useState } from 'react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { isUserFacingError } from '@/lib/errors';
import { fetchWithCache } from '@/lib/api/fetch-wrapper';
import { API } from '@/lib/api/declarations';
import { type FileViewMode } from '@/lib/ui/fileComponents';

interface ConnectionContainerV2Props {
  fileId: FileId;
  mode?: FileViewMode;
  defaultFolder?: string;
}

export default function ConnectionContainerV2({
  fileId,
  mode = 'view',
  defaultFolder = '/org'
}: ConnectionContainerV2Props) {
  const router = useRouter();
  const [saveError, setSaveError] = useState<string | null>(null);

  // Phase 2: Use useFile hook
  const { fileState: file } = useFile(fileId) ?? {};
  const loading = !file || file.loading;
  const saving = file?.saving ?? false;
  const error = file?.loadError ?? null;
  const isDirty = useAppSelector(state => selectIsDirty(state, fileId));
  const effectiveName = useAppSelector(state => selectEffectiveName(state, fileId)) || '';

  // Merge content with persistableChanges
  const currentContent = file ? {
    ...file.content,
    ...file.persistableChanges
  } as ConnectionContent : undefined;

  // Handlers
  const handleChange = useCallback((updates: Partial<ConnectionContent>) => {
    editFile({ fileId: typeof fileId === 'number' ? fileId : -1, changes: { content: updates } });
  }, [fileId]);

  const handleFileNameChange = useCallback((newName: string) => {
    editFile({ fileId: typeof fileId === 'number' ? fileId : -1, changes: { name: newName } });
  }, [fileId]);

  // Phase 2: Save handler
  const handleSave = useCallback(async () => {
    if (!currentContent || !file || typeof fileId !== 'number') return;

    // Clear previous save error
    setSaveError(null);

    try {
      if (mode === 'create') {
        // For create mode, use the special /api/connections POST endpoint
        // This initializes the Python backend connection manager
        const json = await fetchWithCache('/api/connections', {
          method: 'POST',
          body: JSON.stringify({
            name: effectiveName,  // Use effective name (includes metadata changes)
            type: currentContent.type,
            config: currentContent.config
          }),
          cacheStrategy: {
            ttl: 0,
            deduplicate: false,
          },
        });

        console.log('[ConnectionContainerV2] API response:', json);
        // successResponse returns { success: true, data: { id, name, ... } }
        const result = json.data;
        console.log('[ConnectionContainerV2] Extracted result:', result);
        console.log('[ConnectionContainerV2] Current fileId:', fileId);
        redirectAfterSave(result, fileId, router);
      } else {
        // For edit mode, use the Phase 2 unified PATCH endpoint
        const result = await publishFile({ fileId });
        redirectAfterSave(result, fileId, router);
      }
    } catch (error) {
      // User-facing errors should be shown in UI
      if (isUserFacingError(error)) {
        setSaveError(error.message);
        return;
      }

      // Log unexpected errors
      console.error('[ConnectionContainerV2] Failed to save connection:', error);
      setSaveError('An unexpected error occurred. Please try again.');
    }
  }, [currentContent, mode, fileId, router, effectiveName]);

  // Cancel/revert handler
  const handleCancel = useCallback(() => {
    if (mode === 'create') {
      // For new connections, navigate back to home
      router.push('/');
    } else {
      // For existing connections, reload original state
      if (typeof fileId === 'number') {
        reloadFile({ fileId });
      }
    }
  }, [mode, router, fileId]);

  // Reload with force refresh to fetch fresh schema from Python backend
  const handleReload = useCallback(() => {
    if (typeof fileId === 'number') {
      reloadFile({ fileId });
    }
  }, [fileId]);

  // Loading state
  if (loading || !file || !currentContent) {
    return <div>Loading connection...</div>;
  }

  return (
    <ConnectionFormV2
      content={currentContent}
      fileName={effectiveName}
      isDirty={isDirty}
      isSaving={saving}
      saveError={saveError}
      onChange={handleChange}
      onFileNameChange={handleFileNameChange}
      onSave={handleSave}
      onCancel={handleCancel}
      onReload={handleReload}
      mode={mode === 'preview' ? 'view' : mode}
    />
  );
}
