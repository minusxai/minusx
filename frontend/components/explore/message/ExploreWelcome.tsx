'use client';

import { Box, HStack, Heading, Text, Icon, VStack } from '@chakra-ui/react';
import { LuSparkles, LuSearch, LuChartLine, LuLock } from 'react-icons/lu';
import type { IconType } from 'react-icons';

export interface SuggestedPrompt {
  icon?: IconType;
  text: string;
  category?: string;
}

/** Default generic prompts used when a context has no story-specific questions. */
export const DEFAULT_SUGGESTED_PROMPTS: SuggestedPrompt[] = [
  { icon: LuSparkles, text: 'What all can you do?', category: 'Capability' },
  { icon: LuSearch, text: 'Describe our main dashboards / questions', category: 'Search' },
  { icon: LuChartLine, text: 'Show me an interesting visualization', category: 'Analysis' },
];

/** Normalise free-text questions (e.g. from a story) into displayable prompts. */
export function toSuggestedPrompts(texts: string[]): SuggestedPrompt[] {
  return texts.map((text) => ({ icon: LuSparkles, text, category: 'Ask' }));
}

interface ExploreBrandHeaderProps {
  agentName: string;
  colorMode: string;
  /** Optional line under the logo (greeting / call to action). */
  subtitle?: string;
  /** Compact: smaller logo for narrow panels (e.g. the share gate). */
  compact?: boolean;
}

/**
 * The MinusX Explore branding block (logo for MinusX, generic "Ask {agent}"
 * heading otherwise). Shared by the explore empty-state and the public share gate
 * so both surfaces look like one continuous experience.
 */
export function ExploreBrandHeader({ agentName, colorMode, subtitle, compact = false }: ExploreBrandHeaderProps) {
  const isMinusx = agentName.toLowerCase() === 'minusx';
  return (
    <VStack gap={compact ? 1.5 : 2}>
      {isMinusx ? (
        <Box position="relative" overflow="hidden" p={compact ? 1 : 4}>
          <img
            src={colorMode === 'light' ? '/minusx_explore_dark.svg' : '/minusx_explore.svg'}
            alt="minusx explore"
            style={compact
              ? { width: '230px', height: '97px', position: 'relative' }
              : { width: '380px', height: '160px', position: 'relative' }}
          />
        </Box>
      ) : (
        <>
          <Box p={3} borderRadius="full" bg="accent.teal/10" border="2px solid" borderColor="accent.teal/30">
            <Box aria-label="Workspace logo" role="img" boxSize={6} flexShrink={0} />
          </Box>
          <Heading fontSize={compact ? 'lg' : 'xl'} fontWeight="800" fontFamily="mono" color="fg.default" letterSpacing="-0.02em">
            Ask {agentName} anything
          </Heading>
        </>
      )}
      {subtitle && (
        <Text color="fg.muted" fontSize="sm" fontFamily="mono" textAlign="center">
          {subtitle}
        </Text>
      )}
    </VStack>
  );
}

interface SuggestedQuestionCardProps {
  prompt: SuggestedPrompt;
  /** Locked: shown as a teaser (e.g. before sign-in) — non-interactive with a lock affordance. */
  locked?: boolean;
  onClick?: (text: string) => void;
  /** Accent token for the icon chip / category / hover tint (agent-skinned cards). */
  accent?: string;
}

/** A single "try these questions" card. Reused by the explore empty-state and the share gate. */
function SuggestedQuestionCard({ prompt, locked = false, onClick, accent = 'accent.teal' }: SuggestedQuestionCardProps) {
  const PromptIcon = prompt.icon ?? LuSparkles;
  // Locked = a lightweight "preview" row (dashed, no fill, no category) so a stack
  // of them reads as a calm teaser list rather than three heavy interactive cards.
  return (
    <Box
      py={locked ? 2 : 3}
      px={3}
      borderRadius="md"
      border="1px solid"
      borderStyle={locked ? 'dashed' : 'solid'}
      borderColor={locked ? 'border.muted' : 'border.default'}
      bg={locked ? 'transparent' : 'bg.muted'}
      cursor={locked ? 'default' : 'pointer'}
      transition="all 0.2s"
      onClick={locked ? undefined : () => onClick?.(prompt.text)}
      _hover={locked ? undefined : { borderColor: accent, bg: `${accent}/5`, transform: 'translateX(4px)' }}
    >
      <HStack gap={2.5}>
        <Box p={1.5} borderRadius="md" bg={`${accent}/10`}>
          <Icon as={PromptIcon} boxSize={3.5} color={accent} />
        </Box>
        <VStack gap={0} align="start" flex="1">
          {prompt.category && !locked && (
            <Text fontSize="2xs" fontWeight="600" color={accent} textTransform="uppercase" letterSpacing="0.05em" fontFamily="mono">
              {prompt.category}
            </Text>
          )}
          <Text fontSize="sm" fontWeight="500" color={locked ? 'fg.muted' : 'fg.default'} fontFamily="mono">
            {prompt.text}
          </Text>
        </VStack>
        {locked && <Icon as={LuLock} boxSize={3} color="fg.subtle" flexShrink={0} />}
      </HStack>
    </Box>
  );
}

interface SuggestedQuestionsListProps {
  prompts: SuggestedPrompt[];
  locked?: boolean;
  onPromptClick?: (text: string) => void;
  label?: string;
  /** Accent token passed through to the cards (agent-skinned lists). */
  accent?: string;
}

/** "TRY THESE QUESTIONS" label + the stack of cards. */
export function SuggestedQuestionsList({ prompts, locked, onPromptClick, label = 'Try these questions', accent }: SuggestedQuestionsListProps) {
  return (
    <Box width="100%">
      <Text fontSize="xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" mb={2} fontFamily="mono">
        {label}
      </Text>
      <VStack gap={2} align="stretch">
        {prompts.map((prompt, index) => (
          <SuggestedQuestionCard key={index} prompt={prompt} locked={locked} onClick={onPromptClick} accent={accent} />
        ))}
      </VStack>
    </Box>
  );
}
