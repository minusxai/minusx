'use client';

/**
 * ConfigContainer V2 - Phase 2 Implementation
 * Smart component for editing config files (JSON editor)
 *
 * NOTE: This uses setFullContent instead of setEdit because the JSON editor
 * provides the FULL new content on each change. Using merge (setEdit) would
 * prevent field deletions from working properly.
 */
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectIsDirty, isVirtualFileId, setFullContent, clearEdits, setSaving, updateFileContent, addFile, type FileId } from '@/store/filesSlice';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { reloadFile } from '@/lib/api/file-state';
import ConfigEditor from '@/components/config/ConfigEditor';
import { ConfigContent } from '@/lib/types';
import { useMemo, useCallback } from 'react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { FilesAPI } from '@/lib/data/files';
import { slugify } from '@/lib/slug-utils';
import { type FileViewMode } from '@/lib/ui/fileComponents';

interface ConfigContainerV2Props {
  fileId: FileId;
  mode?: FileViewMode;
  defaultFolder?: string;
}

/**
 * Smart component for config pages
 * Uses useFile hook for state management
 * Delegates rendering to ConfigEditor
 */
export default function ConfigContainerV2({
  fileId,
  mode = 'view',
  defaultFolder = '/configs',
}: ConfigContainerV2Props) {
  const router = useRouter();
  const dispatch = useAppDispatch();

  // Use useFile hook for state management (but we'll handle save ourselves)
  const { fileState: file } = useFile(fileId) ?? {};
  const fileLoading = !file || file.loading;
  const saving = file?.saving ?? false;
  const isDirty = useAppSelector(state => selectIsDirty(state, fileId));

  // For JSON editor: use persistableChanges as FULL content (not merged)
  // This allows field deletions to work properly
  const currentContent = useMemo(() => {
    if (!file) return null;
    // If we have edits, use them as the full content; otherwise use original
    const hasEdits = file.persistableChanges && Object.keys(file.persistableChanges).length > 0;
    return (hasEdits ? file.persistableChanges : file.content) as ConfigContent;
  }, [file]);

  // Custom save that uses currentContent directly (no merge)
  const handleSave = useCallback(async () => {
    if (!file || !currentContent) return;

    const effectiveName = file.metadataChanges?.name ?? file.name;
    const folderPath = file.path.substring(0, file.path.lastIndexOf('/')) || '/configs';
    const slug = slugify(effectiveName);
    const newPath = file.metadataChanges?.path ?? `${folderPath}/${slug}`;

    dispatch(setSaving({ id: fileId, saving: true }));

    try {
      if (isVirtualFileId(fileId)) {
        // Create new file
        const result = await FilesAPI.createFile({
          name: effectiveName,
          path: newPath,
          type: file.type,
          content: currentContent,
          references: []
        });
        dispatch(addFile(result.data));
        dispatch(clearEdits(result.data.id));
        router.push(`/f/${result.data.id}`);
      } else {
        // Update existing file - save currentContent directly (full replace)
        const result = await FilesAPI.saveFile(fileId, effectiveName, newPath, currentContent, []);
        dispatch(updateFileContent({ id: fileId, file: result.data }));
        dispatch(clearEdits(fileId));
      }
    } catch (err) {
      console.error('Save failed:', err);
      throw err;
    } finally {
      dispatch(setSaving({ id: fileId, saving: false }));
    }
  }, [file, fileId, currentContent, dispatch, router]);

  // Show loading state while file is loading
  if (fileLoading || !file || !currentContent) {
    return <div>Loading config...</div>;
  }

  // Handle changes from editor - use setFullContent for full replacement
  const handleChange = useCallback((newContent: Partial<ConfigContent>) => {
    dispatch(setFullContent({ fileId, content: newContent }));
  }, [dispatch, fileId]);

  const handleRevert = useCallback(() => {
    if (typeof fileId === 'number') {
      reloadFile({ fileId });
    }
  }, [fileId]);

  return (
    <ConfigEditor
      content={currentContent}
      isDirty={isDirty}
      isSaving={saving}
      onChange={handleChange}
      onSave={handleSave}
      onRevert={handleRevert}
    />
  );
}
