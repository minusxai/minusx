'use client';

/**
 * Container for `viz` recipe files: loads the file, merges staged changes, and
 * renders VizRecipeView (sample-data preview + slots + template). In the file's
 * EDIT mode the view's description/template editors commit through
 * applyJsonContentEdit — the same validated full-replace path as the File tab —
 * so an invalid template is rejected with the reason, and Save/publish stays
 * with the shared file header.
 */
import { useCallback, useMemo } from 'react';
import { useAppSelector } from '@/store/hooks';
import { type FileId } from '@/store/filesSlice';
import { selectFileEditMode } from '@/store/uiSlice';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { applyJsonContentEdit } from '@/lib/file-state/file-state';
import VizRecipeView from '@/components/views/VizRecipeView';
import type { VizRecipeContent } from '@/lib/validation/atlas-schemas';
import { type FileViewMode } from '@/lib/ui/fileComponents';

interface VizRecipeContainerV2Props {
  fileId: FileId;
  mode?: FileViewMode;
  defaultFolder?: string;
}

export default function VizRecipeContainerV2({ fileId }: VizRecipeContainerV2Props) {
  const { fileState: file } = useFile(fileId) ?? {};
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  const editable = useAppSelector((state) => selectFileEditMode(state, fileId as number));

  const content = useMemo(() => {
    if (!file) return null;
    return { ...file.content, ...file.persistableChanges } as VizRecipeContent;
  }, [file]);

  const handleCommit = useCallback(
    (jsonString: string) => applyJsonContentEdit({ fileId: fileId as number, jsonString }),
    [fileId],
  );

  if (!file || file.loading || !content) {
    return <div className="p-4 text-sm text-muted-foreground">Loading recipe…</div>;
  }

  return (
    <VizRecipeView
      content={content}
      colorMode={colorMode}
      editable={editable}
      onCommitContent={handleCommit}
    />
  );
}
