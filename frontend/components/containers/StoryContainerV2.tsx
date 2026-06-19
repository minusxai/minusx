'use client';

/**
 * StoryContainer V2 — smart component for data-story pages.
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
import { useMemo, useState } from 'react';
import { LuGlobe } from 'react-icons/lu';
import { useAppSelector } from '@/store/hooks';
import { selectMergedContent } from '@/store/filesSlice';
import { selectFileViewMode } from '@/store/uiSlice';
import { selectEffectiveUser } from '@/store/authSlice';
import { isAdmin } from '@/lib/auth/role-helpers';
import { useFile } from '@/lib/hooks/file-state-hooks';
import StoryView from '@/components/views/story/StoryView';
import ShareModal from '@/components/share/ShareModal';
import { useFileToolbarActions, type FileToolbarAction } from '@/components/file-toolbar/FileToolbarContext';
import { StoryContent } from '@/lib/types';
import { type FileComponentProps } from '@/lib/ui/fileComponents';

export default function StoryContainerV2({ fileId }: FileComponentProps) {
  const { fileState: file } = useFile(fileId) ?? {};
  const numericId = typeof fileId === 'number' ? fileId : undefined;
  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId)) as StoryContent | undefined;
  const viewMode = useAppSelector(state => selectFileViewMode(state, numericId));
  const effectiveUser = useAppSelector(selectEffectiveUser);

  // Publishing is admin-only; published via a toolbar action + the ShareModal.
  const canShare = numericId !== undefined && isAdmin(effectiveUser?.role || 'viewer');
  const [shareOpen, setShareOpen] = useState(false);
  const toolbarActions = useMemo<FileToolbarAction[]>(
    () => canShare ? [{ id: 'share', ariaLabel: 'Make public', label: 'Make public', icon: <LuGlobe />, onClick: () => setShareOpen(true) }] : [],
    [canShare],
  );
  useFileToolbarActions(toolbarActions);

  if (!file || file.loading || !mergedContent) {
    return <div>Loading story...</div>;
  }

  return (
    <>
      <StoryView content={mergedContent} fileId={numericId} viewMode={viewMode} />
      {canShare && numericId !== undefined && (
        <ShareModal fileId={numericId} fileName={file.name} isOpen={shareOpen} onClose={() => setShareOpen(false)} />
      )}
    </>
  );
}
