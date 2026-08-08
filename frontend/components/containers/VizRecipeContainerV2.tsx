'use client';

/**
 * Container for `viz` recipe files: loads the file, merges staged changes, and
 * renders VizRecipeView (sample-data preview + slots + template). In the file's
 * EDIT mode the view's description/template editors commit through
 * applyJsonContentEdit — the same validated full-replace path as the File tab —
 * so an invalid template is rejected with the reason, and Save/publish stays
 * with the shared file header.
 *
 * A file from the read-only catalog (lib/viz/recipe-catalog.ts — the built-in
 * and shipped recipes, projected as virtual files) renders the same way, plus
 * the notice explaining why it cannot be edited and the copy action, which
 * writes an editable draft into the user's own folder and navigates to it.
 */
import { useCallback, useMemo } from 'react';
import { useAppSelector } from '@/store/hooks';
import { type FileId } from '@/store/filesSlice';
import { selectFileEditMode } from '@/store/uiSlice';
import { selectEffectiveUser } from '@/store/authSlice';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { applyJsonContentEdit, createDraftFile } from '@/lib/file-state/file-state';
import { useRouter } from '@/lib/navigation/use-navigation';
import VizRecipeView from '@/components/views/VizRecipeView';
import type { VizRecipeContent } from '@/lib/validation/atlas-schemas';
import { type FileViewMode } from '@/lib/ui/fileComponents';

interface VizRecipeContainerV2Props {
  fileId: FileId;
  mode?: FileViewMode;
  defaultFolder?: string;
}

/** The catalog markers a virtual recipe file carries on `meta`. */
interface CatalogMeta {
  readOnly?: boolean;
  catalogTier?: 'builtin' | 'shipped';
  catalogCopyable?: boolean;
  previewAssets?: Record<string, string>;
  previewSample?: {
    bindings: Record<string, string | string[]>;
    columns: Array<{ name: string; kind: 'nominal' | 'quantitative' | 'temporal' }>;
    rows: Array<Record<string, unknown>>;
  };
  recipeId?: string;
}

export default function VizRecipeContainerV2({ fileId }: VizRecipeContainerV2Props) {
  const { fileState: file } = useFile(fileId) ?? {};
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  const editable = useAppSelector((state) => selectFileEditMode(state, fileId as number));
  const homeFolder = useAppSelector((state) => selectEffectiveUser(state)?.home_folder);
  const router = useRouter();

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

  const meta = (file as { meta?: CatalogMeta | null } | undefined)?.meta;
  const catalog = useMemo(
    () => (meta?.catalogTier
      ? { tier: meta.catalogTier, recipeId: meta.recipeId, copyable: meta.catalogCopyable !== false }
      : undefined),
    [meta],
  );

  const handleCommit = useCallback(
    (jsonString: string) => applyJsonContentEdit({ fileId: fileId as number, jsonString }),
    [fileId],
  );

  // The copy lands as a DRAFT the user then Saves — same lifecycle as any new
  // file, so the name/path stay editable before anything is published.
  const handleCopy = useCallback(async () => {
    if (!content || !file) return;
    const newId = await createDraftFile('viz', { folder: homeFolder || undefined, name: `${file.name}-copy` });
    applyJsonContentEdit({ fileId: newId, jsonString: JSON.stringify(content) });
    router.push(`/f/${newId}`);
  }, [content, file, homeFolder, router]);

  if (!file || file.loading || !content) {
    return <div className="p-4 text-sm text-muted-foreground">Loading recipe…</div>;
  }

  return (
    <VizRecipeView
      content={content}
      colorMode={colorMode}
      editable={editable && !catalog}
      onCommitContent={handleCommit}
      catalog={catalog}
      previewAssets={meta?.previewAssets ?? null}
      previewSample={meta?.previewSample ?? null}
      onCopyToWorkspace={catalog ? handleCopy : undefined}
    />
  );
}
