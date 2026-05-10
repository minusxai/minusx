'use client';

import { useState } from 'react';
import { HStack, VStack, Text, Icon, GridItem, Box } from '@chakra-ui/react';
import { LuCheck, LuX, LuDatabase, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import { DisplayProps } from '@/lib/types';
import { type DetailCardProps, parseToolContent } from './DetailCarousel';

interface ConnectionEntry {
  name?: string;
  dialect?: string;
  description?: string;
}

function parseConnections(toolMessage: { content: unknown }): ConnectionEntry[] | null {
  try {
    const text = typeof toolMessage.content === 'string'
      ? toolMessage.content
      : JSON.stringify(toolMessage.content);
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed as ConnectionEntry[];
    return null;
  } catch {
    return null;
  }
}

function ConnectionRow({ entry }: { entry: ConnectionEntry }) {
  return (
    <HStack gap={1.5} px={2} py={1} borderRadius="sm" bg="bg.subtle">
      <Icon as={LuDatabase} boxSize={3} color="fg.muted" flexShrink={0} />
      <VStack gap={0} align="start" flex={1} minW={0}>
        <HStack gap={1.5} w="full">
          <Text fontSize="xs" color="fg.default" fontFamily="mono" fontWeight="600" truncate>
            {entry.name ?? '<unnamed>'}
          </Text>
          {entry.dialect && (
            <Box bg="bg.muted" px={1.5} py={0.5} borderRadius="sm">
              <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">{entry.dialect}</Text>
            </Box>
          )}
        </HStack>
        {entry.description && (
          <Text fontSize="2xs" color="fg.muted" fontFamily="mono" truncate w="full">
            {entry.description}
          </Text>
        )}
      </VStack>
    </HStack>
  );
}

// ─── Detail card for AgentTurnContainer carousel ─────────────────────

export function ListDBConnectionsDetailCard({ msg }: DetailCardProps) {
  const parsed = parseToolContent(msg);
  const connections = Array.isArray(parsed) ? (parsed as ConnectionEntry[]) : null;
  return (
    <VStack gap={1} align="stretch" px={3} pb={2}>
      <HStack gap={2} mb={1}>
        <Box bg="bg.muted" px={1.5} py={0.5} borderRadius="full" flexShrink={0}>
          <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="500">DB Connections</Text>
        </Box>
        <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">
          {connections?.length ?? 0} {connections?.length === 1 ? 'connection' : 'connections'}
        </Text>
      </HStack>
      {connections && connections.length > 0 ? (
        connections.map((c, i) => <ConnectionRow key={i} entry={c} />)
      ) : (
        <Text fontSize="xs" color="fg.subtle" fontFamily="mono">No connections</Text>
      )}
    </VStack>
  );
}

// ─── Compact display ─────────────────────────────────────────────────

export default function ListDBConnectionsDisplay({ toolCallTuple, showThinking }: DisplayProps) {
  const [, toolMessage] = toolCallTuple;
  const [isExpanded, setIsExpanded] = useState(false);
  const connections = parseConnections(toolMessage);

  if (!connections) {
    return showThinking ? (
      <GridItem colSpan={12} my={1}>
        <HStack gap={1.5} px={2} py={1.5} bg="accent.danger/10" borderRadius="md" border="1px solid" borderColor="accent.danger/20">
          <Icon as={LuX} boxSize={3} color="accent.danger" flexShrink={0} />
          <Text fontSize="xs" color="accent.danger" fontFamily="mono">
            ListDBConnections failed
          </Text>
        </HStack>
      </GridItem>
    ) : null;
  }

  if (!showThinking) return null;

  const accent = 'accent.cyan';
  const expandable = connections.length > 0;

  return (
    <GridItem colSpan={12} my={1}>
      <Box
        bg={`${accent}/6`}
        borderRadius="md"
        border="1px solid"
        borderColor={`${accent}/15`}
        overflow="hidden"
      >
        <HStack
          gap={1.5}
          py={1.5}
          px={2}
          cursor={expandable ? 'pointer' : 'default'}
          onClick={() => expandable && setIsExpanded(!isExpanded)}
          align="center"
        >
          {expandable ? (
            <Icon as={isExpanded ? LuChevronDown : LuChevronRight} boxSize={3} color={accent} flexShrink={0} />
          ) : (
            <Icon as={LuCheck} boxSize={3} color={accent} flexShrink={0} />
          )}
          <HStack gap={1} minW={0} flex={1}>
            <Icon as={LuDatabase} boxSize={3} color="fg.muted" />
            <Text fontSize="xs" color="fg.muted" fontFamily="mono" truncate>
              Connections
            </Text>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono" flexShrink={0}>
              · {connections.length} {connections.length === 1 ? 'connection' : 'connections'}
            </Text>
          </HStack>
        </HStack>

        {isExpanded && expandable && (
          <VStack gap={1} px={2} pb={2} align="stretch">
            {connections.map((c, i) => <ConnectionRow key={i} entry={c} />)}
          </VStack>
        )}
      </Box>
    </GridItem>
  );
}
