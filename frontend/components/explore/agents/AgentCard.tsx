'use client';

import { Box, HStack, VStack, Text, Icon, IconButton, Button, Badge } from '@chakra-ui/react';
import { LuPlay, LuSettings2 } from 'react-icons/lu';
import { DemoAgent, AGENT_ICONS } from '@/lib/agents/demo-agents';

interface AgentCardProps {
  agent: DemoAgent;
  onLaunch: (slug: string) => void;
  onConfigure: (slug: string) => void;
}

export default function AgentCard({ agent, onLaunch, onConfigure }: AgentCardProps) {
  const AgentIcon = AGENT_ICONS[agent.icon] ?? AGENT_ICONS.bot;

  return (
    <Box
      role="group"
      bg="bg.surface"
      border="1px solid"
      borderColor="border.muted"
      borderRadius="xl"
      p={5}
      display="flex"
      flexDirection="column"
      gap={4}
      cursor="pointer"
      transition="all 0.2s ease"
      _hover={{
        borderColor: agent.accent,
        transform: 'translateY(-2px)',
        boxShadow: 'md',
      }}
      onClick={() => onLaunch(agent.slug)}
    >
      <HStack align="flex-start" justify="space-between">
        <Box p={2.5} borderRadius="lg" bg={`${agent.accent}/10`}>
          <Icon as={AgentIcon} boxSize={6} color={agent.accent} />
        </Box>
        <IconButton
          aria-label={`Configure ${agent.name}`}
          size="sm"
          variant="ghost"
          color="fg.muted"
          _hover={{ color: agent.accent, bg: `${agent.accent}/10` }}
          onClick={(e) => {
            e.stopPropagation();
            onConfigure(agent.slug);
          }}
        >
          <LuSettings2 />
        </IconButton>
      </HStack>

      <VStack align="stretch" gap={1} flex="1">
        <Text fontSize="md" fontWeight="700" fontFamily="mono" color="fg.default" letterSpacing="-0.01em">
          {agent.name}
        </Text>
        <Text fontSize="sm" color="fg.muted" lineClamp={2} lineHeight="1.5">
          {agent.description}
        </Text>
      </VStack>

      <HStack justify="space-between" align="center">
        <HStack gap={1.5}>
          <Badge
            fontSize="2xs"
            fontFamily="mono"
            textTransform="uppercase"
            letterSpacing="0.05em"
            color="fg.muted"
            bg="bg.muted"
            borderRadius="sm"
            px={2}
            py={0.5}
          >
            {agent.preset ? 'Built-in' : 'Custom'}
          </Badge>
          <Badge
            fontSize="2xs"
            fontFamily="mono"
            textTransform="uppercase"
            letterSpacing="0.05em"
            color="accent.cyan"
            bg="accent.cyan/10"
            borderRadius="sm"
            px={2}
            py={0.5}
          >
            {agent.tools.length} {agent.tools.length === 1 ? 'tool' : 'tools'}
          </Badge>
          <Badge
            fontSize="2xs"
            fontFamily="mono"
            textTransform="uppercase"
            letterSpacing="0.05em"
            color="accent.secondary"
            bg="accent.secondary/10"
            borderRadius="sm"
            px={2}
            py={0.5}
          >
            {agent.skills.length} {agent.skills.length === 1 ? 'skill' : 'skills'}
          </Badge>
        </HStack>
        <Button
          aria-label={`Launch ${agent.name}`}
          size="xs"
          bg="accent.teal"
          color="white"
          _hover={{ bg: 'accent.teal', opacity: 0.9 }}
          onClick={(e) => {
            e.stopPropagation();
            onLaunch(agent.slug);
          }}
        >
          <LuPlay />
        </Button>
      </HStack>
    </Box>
  );
}
