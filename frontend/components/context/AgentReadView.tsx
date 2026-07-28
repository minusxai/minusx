'use client';

/**
 * AgentReadView — the finished custom agent as a page of headings/subheadings.
 * Shared between the Agents tab card (saved agents) and the builder's Review
 * step, so what you review is exactly what the card will show.
 */

import { Badge, Box, HStack, Text, VStack } from '@chakra-ui/react';
import type { AgentEntry } from '@/lib/types';

export type AgentDraft = Pick<
  AgentEntry,
  'name' | 'description' | 'prompt' | 'promptMode' | 'preloadSkills' | 'includeSkills' | 'gradeOverride'
>;

export function AgentReadView({ agent }: { agent: AgentDraft }) {
  return (
    <VStack align="stretch" gap={3}>
      <Box>
        <HStack gap={2} align="baseline">
          <Text fontSize="md" fontFamily="mono" fontWeight="700">
            {agent.name}
          </Text>
          <Badge size="xs" colorPalette="gray" variant="subtle">{agent.promptMode}</Badge>
          {agent.gradeOverride && (
            <Badge size="xs" colorPalette="teal" variant="subtle">{agent.gradeOverride}</Badge>
          )}
        </HStack>
        {agent.description && (
          <Text fontSize="sm" color="fg.muted" mt={1}>{agent.description}</Text>
        )}
      </Box>

      <Box>
        <Text fontSize="xs" fontWeight="700" textTransform="uppercase" letterSpacing="wider" color="fg.muted" mb={1}>
          Prompt
        </Text>
        <Text fontSize="sm" whiteSpace="pre-wrap" fontFamily="mono" bg="bg.subtle" p={2} borderRadius="md">
          {agent.prompt || '—'}
        </Text>
        <Text fontSize="2xs" color="fg.subtle" mt={1}>
          {agent.promptMode === 'replace'
            ? 'Replaces the default analyst instructions (schema, context, and skills sections are kept).'
            : 'Appended to the default analyst instructions as an agent persona.'}
        </Text>
      </Box>

      <Box>
        <Text fontSize="xs" fontWeight="700" textTransform="uppercase" letterSpacing="wider" color="fg.muted" mb={1}>
          Preloaded skills
        </Text>
        <Text fontSize="sm" fontFamily="mono">
          {agent.preloadSkills.length > 0 ? agent.preloadSkills.join(', ') : 'None'}
        </Text>
      </Box>

      <Box>
        <Text fontSize="xs" fontWeight="700" textTransform="uppercase" letterSpacing="wider" color="fg.muted" mb={1}>
          Available skills
        </Text>
        <Text fontSize="sm" fontFamily="mono">
          {agent.includeSkills.length > 0 ? agent.includeSkills.join(', ') : 'Full catalog'}
        </Text>
      </Box>
    </VStack>
  );
}
