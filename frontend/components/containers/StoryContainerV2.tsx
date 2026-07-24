'use client';

/**
 * StoryContainer V2 — smart component for story pages.
 *
 * The visual canvas is a viewer: the story HTML is authored by the agent
 * (EditFile on `content.story` / `content.assets`). Rendering through
 * selectMergedContent means unpublished agent edits show live before Publish,
 * same as dashboards. The JSON tab is editable (StoryView wires it by fileId).
 *
 * Publishing is admin-only: the story registers a "Make public" action into the
 * document-header toolbar (the same generic path notebooks use) and owns the
 * ShareModal — so the header has no story-specific code.
 */
import { useCallback, useMemo, useState } from 'react';
import { LuGlobe, LuPalette } from 'react-icons/lu';
import { useAppSelector } from '@/store/hooks';
import { selectMergedContent, selectIsDirty } from '@/store/filesSlice';
import { useStoryPreviewCss } from '@/lib/hooks/use-story-preview-css';
import { selectFileEditMode } from '@/store/uiSlice';
import { selectEffectiveUser } from '@/store/authSlice';
import { isAdmin } from '@/lib/auth/role-helpers';
import { useFile } from '@/lib/hooks/file-state-hooks';
import StoryView from '@/components/views/story/StoryView';
import StoryThemePicker from '@/components/views/story/StoryThemePicker';
import ShareModal from '@/components/share/ShareModal';
import { editFile } from '@/lib/file-state/file-state';
import { STORY_THEMES, storyThemeMode } from '@/lib/data/story/story-themes';
import { useFileToolbarActions, type FileToolbarAction } from '@/components/file-toolbar/FileToolbarContext';
import { StoryContent } from '@/lib/types';
import { type FileComponentProps } from '@/lib/ui/fileComponents';

export default function StoryContainerV2({ fileId }: FileComponentProps) {
  const { fileState: file } = useFile(fileId) ?? {};
  const numericId = typeof fileId === 'number' ? fileId : undefined;
  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId)) as StoryContent | undefined;
  const effectiveUser = useAppSelector(selectEffectiveUser);
  const headerEditMode = useAppSelector(state => (numericId !== undefined ? selectFileEditMode(state, numericId) : false));
  const colorMode = useAppSelector(state => state.ui.colorMode);
  const devMode = useAppSelector(state => state.ui.devMode);
  const isDirty = useAppSelector(state => selectIsDirty(state, fileId));
  // Persisted compiledCss for clean saved stories; preview-compiled for drafts/staged edits.
  const compiledCss = useStoryPreviewCss(mergedContent, isDirty);
  // The story SURFACE renders in the mode of its DESIGN, not the app: a themed story is
  // self-contained (one canonical palette — storyThemeMode derives its designed mode), and an
  // unthemed story may declare a colorMode (a light board deck stays light in a dark app).
  // The resolved mode drives the iframe's .dark/.light class (design-system `dark:` variants +
  // mirrored token CSS) AND the embedded chart stack (via StoryEmbeds' store override).
  const effectiveColorMode = storyThemeMode(mergedContent?.theme)
    ?? (mergedContent?.colorMode as 'light' | 'dark' | null | undefined) ?? colorMode;

  // Publishing is admin-only; published via a toolbar action + the ShareModal.
  const canShare = numericId !== undefined && isAdmin(effectiveUser?.role || 'viewer');
  const [shareOpen, setShareOpen] = useState(false);
  // Design theme picker (Story_Design_V2 §5) — jsx stories only; stages a `content.theme`
  // edit (the shared header's Save persists it, Cancel reverts). All [data-theme] token
  // blocks already ship in compiledCss, so a pick previews instantly (attribute change only).
  const canTheme = numericId !== undefined && mergedContent?.format === 'jsx';
  const [themeOpen, setThemeOpen] = useState(false);
  const onThemeChange = useCallback((theme: string | null) => {
    if (numericId !== undefined) {
      void editFile({ fileId: numericId, changes: { content: { theme: theme as StoryContent['theme'] } } });
    }
  }, [numericId]);
  const toolbarActions = useMemo<FileToolbarAction[]>(
    () => [
      ...(canTheme ? [{ id: 'story-theme', ariaLabel: 'Story theme', label: 'Theme', icon: <LuPalette />, onClick: () => setThemeOpen(true) } satisfies FileToolbarAction] : []),
      ...(canShare ? [{ id: 'share', ariaLabel: 'Make public', label: 'Make public', icon: <LuGlobe />, onClick: () => setShareOpen(true) } satisfies FileToolbarAction] : []),
    ],
    [canShare, canTheme],
  );
  useFileToolbarActions(toolbarActions);

  if (!file || file.loading || !mergedContent) {
    return <div>Loading story...</div>;
  }

  return (
    <>
      <StoryView
        content={mergedContent}
        fileId={numericId}
        headerEditMode={headerEditMode}
        storyPath={numericId !== undefined ? file.path : undefined}
        storyName={numericId !== undefined ? file.name : undefined}
        colorMode={effectiveColorMode}
        compiledCss={compiledCss}
        showDevMarkers={devMode}
      />
      {canShare && numericId !== undefined && (
        <ShareModal fileId={numericId} fileName={file.name} isOpen={shareOpen} onClose={() => setShareOpen(false)} />
      )}
      {canTheme && (
        <StoryThemePicker
          isOpen={themeOpen}
          onClose={() => setThemeOpen(false)}
          themes={STORY_THEMES}
          value={mergedContent.theme ?? null}
          onChange={onThemeChange}
        />
      )}
    </>
  );
}
