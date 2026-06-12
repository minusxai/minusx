'use client';

/**
 * StoryContainer V2 — smart component for data-story pages.
 *
 * v0 is a pure viewer: the story HTML is authored by the agent (EditFile on
 * `content.story` / `content.assets`), so there is no onChange plumbing here.
 * Rendering through selectMergedContent means unpublished agent edits show
 * live before Publish, same as dashboards.
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

  return <StoryView content={mergedContent} viewMode={viewMode} />;
}
