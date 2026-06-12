'use client';

import { Box, Text } from '@chakra-ui/react';
import { LuBookOpen } from 'react-icons/lu';

import AgentHtml from '@/components/views/shared/AgentHtml';
import JsonEditor from '@/components/slides/JsonEditor';
import { StoryContent } from '@/lib/types';
import ScaledStoryFrame, { STORY_W } from './ScaledStoryFrame';

interface StoryViewProps {
  content: StoryContent;
  /** Header eye/code toggle (uiSlice fileViewMode) — same as dashboards. */
  viewMode?: 'visual' | 'json';
}

/**
 * Story view: a single-page scrolling data story — one agent-authored HTML
 * document on a fixed 1280px-wide canvas (any height), with live chart embeds.
 * v0 is a viewer: the story is written/edited by the agent (via EditFile on
 * the file's `content.story`); the JSON view is read-only.
 */
export default function StoryView({ content, viewMode = 'visual' }: StoryViewProps) {
  if (viewMode === 'json') {
    return (
      <JsonEditor
        value={JSON.stringify(content, null, 2)}
        onChange={() => { /* read-only in v0 — edits come from the agent */ }}
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

  // The story is a web page, not a slide: a centered reading column with a
  // FIXED max width, so opening/closing the right sidebar doesn't reflow it —
  // it only shrinks when the container genuinely runs out of room. The story
  // HTML never cares: it's authored on a fixed 1280px logical canvas and
  // ScaledStoryFrame scales it to whatever width this column resolves to.
  return (
    <Box aria-label="Story page" w="100%" minH="420px" display="flex" justifyContent="center">
      <Box w="100%" maxW="960px">
        <ScaledStoryFrame>
          <AgentHtml html={content.story} width={STORY_W} />
        </ScaledStoryFrame>
      </Box>
    </Box>
  );
}
