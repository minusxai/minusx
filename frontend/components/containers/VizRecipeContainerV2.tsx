'use client';

/**
 * Container for `viz` recipe files: loads the file, merges staged changes, and
 * renders the read surface (VizRecipeView — sample-data preview + slots +
 * template). Editing happens through the shared File/Markup tabs or the agent,
 * so this container derives display state only.
 */
import { useMemo } from 'react';
import { useAppSelector } from '@/store/hooks';
import { type FileId } from '@/store/filesSlice';
import { useFile } from '@/lib/hooks/file-state-hooks';
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

  const content = useMemo(() => {
    if (!file) return null;
    return { ...file.content, ...file.persistableChanges } as VizRecipeContent;
  }, [file]);

  if (!file || file.loading || !content) {
    return <div className="p-4 text-sm text-muted-foreground">Loading recipe…</div>;
  }

  return <VizRecipeView content={content} colorMode={colorMode} />;
}
