'use client';

/**
 * Container for the Templates page: reads the shipped catalog, owns Redux and
 * navigation, and hands TemplatesView pure props. "Copy to my workspace"
 * creates a real `.viz` DRAFT in the user's home folder and opens it — the same
 * lifecycle as any new file, so the name and path stay editable until Save.
 */
import { useCallback, useMemo } from 'react';
import { useAppSelector } from '@/store/hooks';
import { selectEffectiveUser } from '@/store/authSlice';
import { selectVizTemplates } from '@/store/configsSlice';
import { applyJsonContentEdit, createDraftFile } from '@/lib/file-state/file-state';
import { useRouter } from '@/lib/navigation/use-navigation';
import { canCreateFileByRole } from '@/lib/auth/access-rules.client';
import { catalogEntries, type CatalogEntry } from '@/lib/viz/recipe-catalog';
import TemplatesView from '@/components/views/TemplatesView';

export default function TemplatesContainerV2() {
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  const user = useAppSelector(selectEffectiveUser);
  const router = useRouter();

  // The built-in half of the catalog comes from REDUX, not from the recipe
  // module's state: that state is written by DataLoader's effect, so reading it
  // during render disagrees with the server (React #418) and a memo with no
  // dependency on it never picks the templates up at all.
  const vizTemplates = useAppSelector(selectVizTemplates);
  const entries = useMemo(() => catalogEntries(vizTemplates), [vizTemplates]);

  const canCopy = !user?.role || canCreateFileByRole(user.role, 'viz');

  const handleCopy = useCallback(async (entry: CatalogEntry) => {
    const newId = await createDraftFile('viz', {
      folder: user?.home_folder || undefined,
      name: `${entry.name}-copy`,
    });
    applyJsonContentEdit({ fileId: newId, jsonString: JSON.stringify(entry.content) });
    router.push(`/f/${newId}`);
  }, [user?.home_folder, router]);

  return (
    <TemplatesView
      entries={entries}
      colorMode={colorMode}
      onCopy={canCopy ? handleCopy : undefined}
    />
  );
}
