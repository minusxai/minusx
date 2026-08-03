'use client';

import { useState, useRef, useEffect } from 'react';
import { Box, HStack, Text, Collapsible, Icon } from '@chakra-ui/react';
import { LuSparkles, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import ChatInterface from '@/components/explore/ChatInterface';
import { useConfigs } from '@/lib/hooks/useConfigs';

/**
 * Collapsible agent trace — auto-opens when first rendered.
 *
 * `hasFailed` is separate from `!isRunning` because a crashed run stops running exactly like a
 * successful one: without it the chip read "Done!" with the error banner visible inside the panel.
 */
export default function AgentFeedCollapsible({ connectionName, contextPath, isRunning, hasFailed = false }: { connectionName: string; contextPath: string; isRunning: boolean; hasFailed?: boolean }) {
  const { config } = useConfigs();
  const agentName = config.branding.agentName;
  const [isOpen, setIsOpen] = useState(true);
  const wasRunningRef = useRef(isRunning);
  useEffect(() => {
    // Auto-close when the agent transitions from running → done. A FAILED run keeps the panel open:
    // the error the user has to act on is inside it.
    if (wasRunningRef.current && !isRunning && !hasFailed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsOpen(false);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, hasFailed]);
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
          {!isRunning && !hasFailed && (
            <Text fontSize="xs" fontFamily="mono" color="accent.teal" flex={1}>
              Done!
            </Text>
          )}
          {hasFailed && (
            <Text fontSize="xs" fontFamily="mono" color="accent.danger" flex={1}>
              Failed
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
