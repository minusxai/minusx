'use client';

/**
 * Container for `viz` recipe files: loads the file, merges staged changes, and
 * renders VizRecipeView (sample-data preview + slots + template). In the file's
 * EDIT mode the view's description/template editors commit through
 * applyJsonContentEdit — the same validated full-replace path as the File tab —
 * so an invalid template is rejected with the reason, and Save/publish stays
 * with the shared file header.
 *
 * This is the WORKSPACE file surface only. The app's own templates are not
 * files and never reach here — they are browsed on `/templates`, which renders
 * the same `VizRecipeView` with its catalog props (see lib/templates).
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

  // A file first seen through a FOLDER LISTING is metadata-only (`getFiles`
  // skips content), and spreading a null content yields `{}` — truthy, but with
  // no `bindings`, which the view iterates. Require a real recipe, not merely a
  // truthy object, or clicking a recipe from its folder throws into the page
  // error boundary before the content load lands.
  const content = useMemo(() => {
    if (!file) return null;
    const merged = { ...file.content, ...file.persistableChanges } as VizRecipeContent;
    return Array.isArray(merged?.bindings) && merged.template ? merged : null;
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
