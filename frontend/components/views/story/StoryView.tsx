'use client';

import { Box, Text } from '@chakra-ui/react';
import { LuBookOpen } from 'react-icons/lu';

import AgentHtml from '@/components/views/shared/AgentHtml';
import ScaledStoryFrame, { STORY_W } from './ScaledStoryFrame';

interface StoryViewProps {
  story?: string | null;
}

/**
 * Story view: a single-page scrolling data story — one agent-authored HTML
 * document on a fixed 1280px-wide canvas (any height), with live chart embeds.
 * v0 is a viewer: the story is written/edited by the agent (via EditFile on
 * the dashboard's `story`).
 */
export default function StoryView({ story }: StoryViewProps) {
  if (!story) {
    return (
      <Box aria-label="No story" minH="420px" p={10} display="flex" flexDirection="column" alignItems="center" justifyContent="center">
        <Box mb={3} opacity={0.3}><LuBookOpen size={64} strokeWidth={1.5} /></Box>
        <Text fontSize="lg" fontWeight={700} color="fg.default">No story yet</Text>
        <Text fontSize="sm" color="fg.muted" mt={1}>Ask the agent to write a data story from this dashboard.</Text>
      </Box>
    );
  }

  // The story is a web page, not a slide: a centered reading column — 70% of
  // the content width on large screens, full width on small. The story HTML
  // never cares: it's authored on a fixed 1280px logical canvas and
  // ScaledStoryFrame scales it to whatever width this container resolves to.
  return (
    <Box aria-label="Story page" w="100%" minH="420px" display="flex" justifyContent="center">
      <Box w={{ base: '100%', lg: '70%' }}>
        <ScaledStoryFrame>
          <AgentHtml html={story} width={STORY_W} />
        </ScaledStoryFrame>
      </Box>
    </Box>
  );
}
