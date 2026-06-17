'use client';

/**
 * StoryContainer V2 — smart component for data-story pages.
 *
 * The visual canvas is a viewer: the story HTML is authored by the agent
 * (EditFile on `content.story` / `content.assets`). Rendering through
 * selectMergedContent means unpublished agent edits show live before Publish,
 * same as dashboards. The JSON tab is editable (StoryView wires it by fileId).
 */
import { useAppSelector } from '@/store/hooks';
import { selectMergedContent } from '@/store/filesSlice';
import { selectFileViewMode } from '@/store/uiSlice';
import { useFile } from '@/lib/hooks/file-state-hooks';
import StoryView from '@/components/views/story/StoryView';
import { StoryContent } from '@/lib/types';
import { type FileComponentProps } from '@/lib/ui/fileComponents';

export default function StoryContainerV2({ fileId }: FileComponentProps) {
  const { fileState: file } = useFile(fileId) ?? {};
  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId)) as StoryContent | undefined;
  const viewMode = useAppSelector(state => selectFileViewMode(state, typeof fileId === 'number' ? fileId : undefined));

  if (!file || file.loading || !mergedContent) {
    return <div>Loading story...</div>;
  }

  return <StoryView content={mergedContent} fileId={typeof fileId === 'number' ? fileId : undefined} viewMode={viewMode} />;
}
