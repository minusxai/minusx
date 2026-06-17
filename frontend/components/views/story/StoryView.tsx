'use client';

import { useState } from 'react';
import { Box, Text } from '@chakra-ui/react';
import { LuBookOpen } from 'react-icons/lu';

import AgentHtml from '@/components/views/shared/AgentHtml';
import JsonEditor from '@/components/slides/JsonEditor';
import { StoryContent } from '@/lib/types';
import { useAppSelector } from '@/store/hooks';
import { selectPersistableContent } from '@/store/filesSlice';
import { applyJsonContentEdit } from '@/lib/api/file-state';
import ScaledStoryFrame, { STORY_W } from './ScaledStoryFrame';

// Max on-screen width of the reading column. The story scales to fill THIS
// (capped) width, not the raw container — so toggling the chat sidebar only
// eats the side buffer, and the story keeps a constant size. It only re-scales
// down once the available width drops below this (window genuinely too narrow,
// e.g. small screen + sidebar open). Raise for a bigger story / less buffer,
// lower for rock-solid stability on narrower screens.
const STORY_MAX_W = '1200px';

interface StoryViewProps {
  content: StoryContent;
  /** File id — enables JSON-tab editing (same as question/dashboard). */
  fileId?: number;
  /** Header eye/code toggle (uiSlice fileViewMode) — same as dashboards. */
  viewMode?: 'visual' | 'json';
  /** Public read-only render (shared story): embedded charts hide actions + auth-gated links. */
  readOnly?: boolean;
}

/**
 * Story view: a single-page scrolling data story — one agent-authored HTML
 * document on a fixed 1280px-wide canvas (any height), with live chart embeds.
 * The visual canvas is a viewer (the story is written by the agent via EditFile
 * on `content.story`); the JSON tab is an editable full-content editor — same as
 * question/dashboard — when a `fileId` is supplied.
 */
export default function StoryView({ content, fileId, viewMode = 'visual', readOnly = false }: StoryViewProps) {
  // JSON tab edits the persistable content (content + persistableChanges, no ephemerals)
  const persistableContent = useAppSelector(state =>
    fileId !== undefined ? selectPersistableContent(state, fileId) : undefined
  );
  const [jsonError, setJsonError] = useState<string | null>(null);
  const jsonEditable = fileId !== undefined;

  if (viewMode === 'json') {
    return (
      <JsonEditor
        value={JSON.stringify(persistableContent ?? content, null, 2)}
        readOnly={!jsonEditable}
        error={jsonError}
        onChange={(value) => {
          if (fileId === undefined) return;
          const result = applyJsonContentEdit({ fileId, jsonString: value });
          setJsonError(result.success ? null : result.error ?? null);
        }}
      />
    );
  }

  if (!content.story) {
    return (
      <Box aria-label="No story" minH="420px" p={10} display="flex" flexDirection="column" alignItems="center" justifyContent="center">
        <Box mb={3} opacity={0.3}><LuBookOpen size={64} strokeWidth={1.5} /></Box>
        <Text fontSize="lg" fontWeight={700} color="fg.default">No story yet</Text>
        <Text fontSize="sm" color="fg.muted" mt={1}>Ask the agent to write a data story.</Text>
      </Box>
    );
  }

  // The story is a web page authored on a fixed 1280px logical canvas;
  // ScaledStoryFrame scales it to whatever width its column resolves to. Cap
  // that column at STORY_MAX_W and center it, so opening/closing the chat
  // sidebar only changes the side buffer — not the scale — and the story stops
  // resizing on every toggle (it only shrinks when the window is genuinely too
  // narrow to hold STORY_MAX_W).
  return (
    <Box aria-label="Story page" w="100%" minH="420px" display="flex" justifyContent="center">
      <Box w="100%" maxW={STORY_MAX_W} {...(fileId !== undefined ? { 'data-story-capture': fileId } : {})}>
        <ScaledStoryFrame>
          <AgentHtml html={content.story} width={STORY_W} readOnly={readOnly} />
        </ScaledStoryFrame>
      </Box>
    </Box>
  );
}
