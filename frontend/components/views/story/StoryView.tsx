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
import { STORY_W } from './ScaledStoryFrame';

// Max on-screen width of the reading column. Stories render FLUID (no transform
// scale): full-bleed on mobile, capped + centered here on desktop. Authored
// against a ~1280px canvas, so cap at the same so desktop matches the design
// while everything below reflows responsively (container queries + cqi).
const STORY_MAX_W = '1280px';

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

  // Render the story as a FLUID responsive document — no transform scale.
  // Full-bleed on mobile; capped at STORY_MAX_W and centered on desktop so it
  // matches its ~1280px design canvas. Everything below STORY_MAX_W reflows via
  // the story's own container queries / cqi units.
  return (
    <Box aria-label="Story page" w="100%" minH="420px" display="flex" justifyContent="center">
      <Box w="100%" maxW={STORY_MAX_W} {...(fileId !== undefined ? { 'data-story-capture': fileId } : {})}>
        <AgentHtml html={content.story} width={STORY_W} fluid readOnly={readOnly} />
      </Box>
    </Box>
  );
}
