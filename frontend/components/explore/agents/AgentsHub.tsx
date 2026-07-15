'use client';

import { useState } from 'react';
import { Box, HStack, VStack, Heading, Text, Button, SimpleGrid } from '@chakra-ui/react';
import { LuPlus } from 'react-icons/lu';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { selectAgents, setActiveAgent } from '@/store/agentsSlice';
import AgentCard from './AgentCard';
import AgentWizardModal from './AgentWizardModal';

/**
 * The /explore landing: a grid of demo agents plus the Create Agent wizard.
 * Launch activates an agent (the chat skin takes over); the gear reopens the
 * wizard prefilled for that agent.
 */
export default function AgentsHub() {
  const dispatch = useAppDispatch();
  const agents = useAppSelector(selectAgents);
  const [wizard, setWizard] = useState<{ open: boolean; editingSlug: string | null }>({
    open: false,
    editingSlug: null,
  });

  const editingAgent = wizard.editingSlug
    ? agents.find(a => a.slug === wizard.editingSlug) ?? null
    : null;

  return (
    <Box height="100%" overflowY="auto" px={{ base: 4, md: 8, lg: 12 }} py={{ base: 4, md: 6 }}>
      <VStack align="stretch" gap={6} maxW="1200px" mx="auto">
        <HStack justify="space-between" align="flex-start" gap={4}>
          <VStack align="flex-start" gap={1}>
            <Heading fontSize="2xl" fontWeight="800" fontFamily="mono" letterSpacing="-0.02em" color="fg.default">
              Agents
            </Heading>
            <Text fontSize="sm" color="fg.muted">
              Pick an agent to explore your data, or build your own.
            </Text>
          </VStack>
          <Button
            aria-label="Create agent"
            bg="accent.teal"
            color="white"
            size="xs"
            _hover={{ bg: 'accent.teal', opacity: 0.9 }}
            onClick={() => setWizard({ open: true, editingSlug: null })}
          >
            <LuPlus /> Create Agent
          </Button>
        </HStack>

        <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} gap={4}>
          {agents.map(agent => (
            <AgentCard
              key={agent.slug}
              agent={agent}
              onLaunch={(slug) => dispatch(setActiveAgent(slug))}
              onConfigure={(slug) => setWizard({ open: true, editingSlug: slug })}
            />
          ))}
        </SimpleGrid>
      </VStack>

      <AgentWizardModal
        isOpen={wizard.open}
        editingAgent={editingAgent}
        onClose={() => setWizard({ open: false, editingSlug: null })}
      />
    </Box>
  );
}
