'use client';

import { useState, useRef, useEffect } from 'react';
import { Box, HStack, Text, Collapsible, Icon } from '@chakra-ui/react';
import { LuSparkles, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import ChatInterface from '@/components/explore/ChatInterface';
import { useConfigs } from '@/lib/hooks/useConfigs';

/** Collapsible agent trace — auto-opens when first rendered */
export default function AgentFeedCollapsible({ connectionName, contextPath, isRunning }: { connectionName: string; contextPath: string; isRunning: boolean }) {
  const { config } = useConfigs();
  const agentName = config.branding.agentName;
  const [isOpen, setIsOpen] = useState(true);
  const wasRunningRef = useRef(isRunning);
  useEffect(() => {
    // Auto-close when agent transitions from running → done
    if (wasRunningRef.current && !isRunning) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsOpen(false);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning]);
  return (
    <Collapsible.Root open={isOpen} onOpenChange={(e) => setIsOpen(e.open)}>
      <Collapsible.Trigger asChild>
        <HStack
          cursor="pointer"
          px={3}
          py={2}
          bg="bg.muted"
          borderRadius="lg"
          _hover={{ bg: 'bg.emphasis' }}
          gap={2}
          justify={"space-between"}
        >
          <HStack>
          <Icon as={LuSparkles} boxSize={3.5} color="accent.teal" />
          <Text fontSize="sm" fontFamily="mono" fontWeight="500" color="accent.teal">
            {isOpen ? `Hide ${agentName} agent trace` : `See ${agentName} agent in action`}
          </Text>
          </HStack>
          <HStack>
          {isRunning && (
            <Text fontSize="xs" fontFamily="mono" color="fg.subtle" flex={1}>
              Exploring tables & writing first draft (~30s)
            </Text>
          )}
          {!isRunning && (
            <Text fontSize="xs" fontFamily="mono" color="accent.teal" flex={1}>
              Done!
            </Text>
          )}
          {!isRunning && !isOpen && <Box flex={1} />}
          <Icon
            as={isOpen ? LuChevronDown : LuChevronRight}
            boxSize={4}
            color="fg.subtle"
          />
          </HStack>
        </HStack>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <Box
          border="1px solid"
          borderColor="border.default"
          borderRadius="lg"
          overflow="hidden"
          h="350px"
          mt={2}
        >
          <ChatInterface
            contextPath={contextPath}
            databaseName={connectionName}
            container="sidebar"
            readOnly
          />
        </Box>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
