'use client';

/**
 * AgentReadView — the finished custom-agent summary shared by saved cards and
 * the builder review step. The saved card can supply status/actions through
 * `headerEnd`, while the review step renders the same identity and content.
 */

import type { ReactNode } from 'react';
import { Badge, Box, HStack, Icon, Text, VStack } from '@chakra-ui/react';
import { LuBot, LuCornerDownRight, LuCpu, LuLibrary, LuQuote, LuReplace, LuZap } from 'react-icons/lu';
import type { AgentEntry } from '@/lib/types';
import { getUserAgentDisplayName } from '@/lib/context/agent-utils';

type AgentReadModel = Pick<
  AgentEntry,
  'name' | 'displayName' | 'description' | 'prompt' | 'promptMode' | 'preloadSkills' | 'includeSkills' | 'gradeOverride' | 'enabled'
>;

export type AgentDraft = Omit<AgentReadModel, 'displayName'> & { displayName: string };

interface AgentReadViewProps {
  agent: AgentReadModel;
  headerEnd?: ReactNode;
  footerEnd?: ReactNode;
  compact?: boolean;
  muted?: boolean;
  showSettings?: boolean;
}

const COMPACT_INSTRUCTION_CHARS = 240;

function monogram(name: string) {
  const letters = name
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return letters || 'AI';
}

function SkillPills({
  skills,
  emptyLabel,
  catalog,
  muted,
  compact,
}: {
  skills: string[];
  emptyLabel: string;
  catalog?: boolean;
  muted?: boolean;
  compact?: boolean;
}) {
  if (skills.length === 0) {
    return (
      <Badge
        size={compact ? 'xs' : 'sm'}
        variant="subtle"
        colorPalette="gray"
        px={compact ? 2 : 2.5}
        py={compact ? 0.5 : 1}
        borderRadius="full"
        w="fit-content"
      >
        {catalog && <Icon as={LuLibrary} boxSize={3} mr={1} />}
        {emptyLabel}
      </Badge>
    );
  }

  const visibleSkills = compact && skills.length > 6 ? skills.slice(0, 6) : skills;
  const hiddenCount = skills.length - visibleSkills.length;

  return (
    <Box
      display="flex"
      flexWrap="wrap"
      gap={1.5}
    >
      {visibleSkills.map((skill) => (
        <Badge
          key={skill}
          size={compact ? 'xs' : 'sm'}
          variant="subtle"
          colorPalette={muted ? 'gray' : 'teal'}
          px={compact ? 2 : 2.5}
          py={compact ? 0.5 : 1}
          borderRadius="full"
          fontFamily="mono"
          fontWeight="600"
          w="fit-content"
          justifySelf="start"
          maxW="100%"
          overflow="hidden"
          textOverflow="ellipsis"
          whiteSpace="nowrap"
        >
          {skill}
        </Badge>
      ))}
      {hiddenCount > 0 && (
        <Badge
          size={compact ? 'xs' : 'sm'}
          variant="outline"
          colorPalette="gray"
          px={compact ? 2 : 2.5}
          py={compact ? 0.5 : 1}
          borderRadius="full"
          fontFamily="mono"
          fontWeight="600"
          w="fit-content"
          justifySelf="start"
          whiteSpace="nowrap"
        >
          +{hiddenCount} more
        </Badge>
      )}
    </Box>
  );
}

export function AgentReadView({
  agent,
  headerEnd,
  footerEnd,
  compact = false,
  muted = false,
  showSettings = true,
}: AgentReadViewProps) {
  const instructions = agent.prompt || 'No custom instructions yet.';
  const agentDisplayName = getUserAgentDisplayName(agent);
  const onDemandSkills = agent.includeSkills.filter((skill) => !agent.preloadSkills.includes(skill));
  const visibleInstructions = compact && instructions.length > COMPACT_INSTRUCTION_CHARS
    ? `${instructions.slice(0, COMPACT_INSTRUCTION_CHARS).trimEnd()}…`
    : instructions;

  return (
    <VStack align="stretch" gap={compact ? 4 : 5} h="100%">
      <HStack align="start" justify="space-between" gap={compact ? 3 : 4} flexWrap="wrap">
        <HStack align="start" gap={compact ? 3 : 4} minW={0} flex="1">
          <Box
            aria-hidden="true"
            position="relative"
            display="flex"
            alignItems="center"
            justifyContent="center"
            w={compact ? '60px' : '72px'}
            h={compact ? '60px' : '72px'}
            flexShrink={0}
            borderRadius={compact ? '18px 18px 18px 7px' : '22px 22px 22px 8px'}
            border="1px solid"
            borderColor={muted ? 'border.default' : 'accent.teal/30'}
            bg={muted ? 'bg.muted' : 'accent.teal/12'}
            color={muted ? 'fg.muted' : 'accent.teal'}
            boxShadow={muted ? 'none' : '0 8px 22px rgba(13, 148, 136, 0.14)'}
            transition="transform 180ms ease"
            _groupHover={{ transform: 'translateY(-2px) scale(1.02)' }}
          >
            <Text fontSize={compact ? 'xl' : '2xl'} lineHeight="1" fontWeight="800" letterSpacing="-0.04em">
              {monogram(agentDisplayName)}
            </Text>
            <Box
              position="absolute"
              right="-5px"
              bottom="-5px"
              display="flex"
              alignItems="center"
              justifyContent="center"
              w={compact ? '20px' : '24px'}
              h={compact ? '20px' : '24px'}
              borderRadius="full"
              bg={muted ? 'fg.subtle' : 'accent.teal'}
              color="white"
              border={compact ? '2px solid' : '3px solid'}
              borderColor={muted ? 'bg.subtle' : 'bg.panel'}
            >
              <Icon as={LuBot} boxSize={compact ? 2.5 : 3} />
            </Box>
          </Box>

          <Box minW={0} pt={0.5}>
            <Text fontSize={compact ? 'lg' : 'xl'} lineHeight="1.15" fontWeight="750" letterSpacing="-0.02em">
              {agentDisplayName || 'Untitled agent'}
            </Text>
            <Text fontSize="xs" fontFamily="mono" color="fg.subtle" mt={1}>
              @{agent.name || 'untitled'}
            </Text>
            {agent.description && (
              <Text fontSize="sm" color="fg.muted" mt={compact ? 1.5 : 2} lineClamp={2}>{agent.description}</Text>
            )}
          </Box>
        </HStack>

        {headerEnd && <Box flexShrink={0}>{headerEnd}</Box>}
      </HStack>

      <Box borderTop="1px solid" borderColor="border.muted" pt={compact ? 3 : 4}>
        <HStack gap={1.5} mb={compact ? 2 : 3} color="fg.muted">
          <Icon as={LuQuote} boxSize={3.5} />
          <Text fontSize="2xs" fontWeight="700" textTransform="uppercase" letterSpacing="0.12em">
            Instructions
          </Text>
        </HStack>
        <Text
          fontSize="sm"
          lineHeight={compact ? '1.5' : '1.65'}
          whiteSpace="pre-wrap"
          color="fg.default"
          w="100%"
        >
          {visibleInstructions}
        </Text>
      </Box>

      {showSettings && <Box>
        <HStack gap={3} mb={compact ? 3 : 4}>
          <Text fontSize="2xs" fontWeight="700" textTransform="uppercase" letterSpacing="0.12em" color="fg.muted">
            Settings
          </Text>
          <Box h="1px" flex="1" bg="border.muted" />
        </HStack>
        <Box
          display="grid"
          gridTemplateColumns={{ base: '1fr', md: 'repeat(2, minmax(0, 1fr))' }}
          gap={compact ? 4 : 5}
        >
          <Box minW={0}>
            <Text fontSize="2xs" fontWeight="700" textTransform="uppercase" letterSpacing="0.1em" color="fg.subtle" mb={1.5}>
              Prompt behavior
            </Text>
            <HStack gap={1.5} color="fg.muted">
              <Icon
                as={agent.promptMode === 'replace' ? LuReplace : LuCornerDownRight}
                boxSize={3.5}
                color={muted ? 'fg.subtle' : 'accent.teal'}
              />
              <Text fontSize="xs" fontWeight="650">
                {agent.promptMode === 'replace' ? 'Replaces default agent prompt' : 'Extends default agent prompt'}
              </Text>
            </HStack>
          </Box>
          <Box minW={0}>
            <Text fontSize="2xs" fontWeight="700" textTransform="uppercase" letterSpacing="0.1em" color="fg.subtle" mb={1.5}>
              Model grade
            </Text>
            <HStack gap={1.5} color="fg.muted">
              <Icon as={LuCpu} boxSize={3.5} />
              <Text fontSize="xs" fontWeight="650" textTransform="capitalize">
                {agent.gradeOverride ? `${agent.gradeOverride} model` : 'Workspace default'}
              </Text>
            </HStack>
          </Box>
        </Box>
      </Box>}

      <Box mt="auto">
        <HStack gap={3} mb={compact ? 3 : 4}>
          <Text fontSize="2xs" fontWeight="700" textTransform="uppercase" letterSpacing="0.12em" color="fg.muted">
            Skills
          </Text>
          <Box h="1px" flex="1" bg="border.muted" />
        </HStack>
        <Box
          display="grid"
          gridTemplateColumns={{ base: '1fr', md: 'repeat(2, minmax(0, 1fr))' }}
          gap={compact ? 4 : 5}
        >
          <Box minW={0}>
            <HStack gap={1.5} mb={2} color="fg.muted">
              <Icon as={LuZap} boxSize={3.5} color={muted ? 'fg.subtle' : 'accent.teal'} />
              <Text fontSize="2xs" fontWeight="700" textTransform="uppercase" letterSpacing="0.12em">
                Preloaded
              </Text>
            </HStack>
            <SkillPills skills={agent.preloadSkills} emptyLabel="None" muted={muted} compact={compact} />
          </Box>

          <Box minW={0}>
            <HStack gap={1.5} mb={2} color="fg.muted">
              <Icon as={LuLibrary} boxSize={3.5} />
              <Text fontSize="2xs" fontWeight="700" textTransform="uppercase" letterSpacing="0.12em">
                Available
              </Text>
            </HStack>
            <SkillPills
              skills={onDemandSkills}
              emptyLabel="None"
              muted={muted}
              compact={compact}
            />
          </Box>
        </Box>
      </Box>

      {footerEnd && <HStack justify="flex-end">{footerEnd}</HStack>}
    </VStack>
  );
}
