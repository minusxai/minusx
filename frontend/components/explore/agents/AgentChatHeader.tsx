'use client';

import { Box, HStack, Text, Icon, Badge, Button } from '@chakra-ui/react';
import { LuArrowLeft } from 'react-icons/lu';
import { useRouter } from '@/lib/navigation/use-navigation';
import { useAppDispatch } from '@/store/hooks';
import { clearActiveAgent } from '@/store/agentsSlice';
import { DemoAgent, AGENT_ICONS } from '@/lib/agents/demo-agents';

/** Slim identity strip above the chat while an agent is active. */
export default function AgentChatHeader({ agent }: { agent: DemoAgent }) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const AgentIcon = AGENT_ICONS[agent.icon] ?? AGENT_ICONS.bot;

  return (
    <HStack
      px={{ base: 4, md: 8, lg: 12 }}
      py={2}
      justify="space-between"
      borderBottom="1px solid"
      borderColor="border.muted"
    >
      <HStack gap={2.5}>
        <Box p={1.5} borderRadius="md" bg={`${agent.accent}/10`}>
          <Icon as={AgentIcon} boxSize={4} color={agent.accent} />
        </Box>
        <Text fontSize="sm" fontWeight="700" fontFamily="mono" color="fg.default">
          {agent.name}
        </Text>
        <Badge
          fontSize="2xs"
          fontFamily="mono"
          textTransform="uppercase"
          letterSpacing="0.05em"
          color={agent.accent}
          bg={`${agent.accent}/10`}
          borderRadius="sm"
          px={2}
          py={0.5}
        >
          Agent
        </Badge>
      </HStack>
      <Button
        aria-label="Back to agents"
        size="xs"
        variant="ghost"
        color="fg.muted"
        _hover={{ color: 'fg.default', bg: 'bg.muted' }}
        onClick={() => {
          dispatch(clearActiveAgent());
          router.push('/explore');
        }}
      >
        <LuArrowLeft /> All agents
      </Button>
    </HStack>
  );
}
