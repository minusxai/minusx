'use client';

import { Box, HStack, VStack, Text, Icon, GridItem } from '@chakra-ui/react';
import { LuCheck, LuX, LuLibrary, LuLoader } from 'react-icons/lu';
import { DisplayProps, contentToDetails } from '@/lib/types';
import { type DetailCardProps, parseToolArgs, parseToolContent, isToolSuccess } from './DetailCarousel';

interface LoadedDoc {
  key: string;
  title: string;
  content: string;
}

// Pull the loaded docs / requested keys out of the tool message + args.
function extractDocs(content: any, args: any): { docs: LoadedDoc[]; missing: string[] } {
  const docs: LoadedDoc[] = Array.isArray(content?.docs) ? content.docs : [];
  const missing: string[] = Array.isArray(content?.missing) ? content.missing : [];
  // Fall back to the requested keys when the payload doesn't carry doc titles.
  if (docs.length === 0 && Array.isArray(args?.keys)) {
    return { docs: args.keys.map((k: string) => ({ key: k, title: k, content: '' })), missing };
  }
  return { docs, missing };
}

// ─── Detail card for AgentTurnContainer carousel ──────────────────

export function LoadContextDetailCard({ msg }: DetailCardProps) {
  const args = parseToolArgs(msg);
  const content = parseToolContent(msg);
  const success = isToolSuccess(msg);
  const { docs, missing } = extractDocs(content, args);

  return (
    <Box mx={3} mb={2} p={3} bg="bg.subtle" borderRadius="md" border="1px solid" borderColor="border.default">
      <HStack gap={2} mb={docs.length > 0 ? 2 : 0}>
        <Icon as={success ? LuLibrary : LuX} boxSize={4}
          color={success ? 'fg.muted' : 'accent.danger'} />
        <VStack gap={0} align="start" flex={1} minW={0}>
          <Text fontSize="sm" fontFamily="mono" color="fg.default" fontWeight="600">
            {docs.length === 1 ? '1 context doc' : `${docs.length} context docs`}
          </Text>
          <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">
            {success ? 'Context loaded' : 'Failed to load'}
          </Text>
        </VStack>
        <Box bg={success ? 'accent.teal/10' : 'accent.danger/10'} px={2} py={0.5} borderRadius="full" flexShrink={0}>
          <Text fontSize="2xs" fontFamily="mono" color={success ? 'accent.teal' : 'accent.danger'} fontWeight="500">
            {success ? 'Loaded' : 'Error'}
          </Text>
        </Box>
      </HStack>
      {docs.length > 0 && (
        <VStack gap={1} align="stretch">
          {docs.map((doc) => (
            <HStack key={doc.key} gap={1.5}>
              <Icon as={LuCheck} boxSize={3} color="accent.success" flexShrink={0} />
              <Text fontSize="xs" fontFamily="mono" color="fg.default" truncate>
                {doc.title || doc.key}
              </Text>
            </HStack>
          ))}
          {missing.map((key) => (
            <HStack key={key} gap={1.5}>
              <Icon as={LuX} boxSize={3} color="accent.danger" flexShrink={0} />
              <Text fontSize="xs" fontFamily="mono" color="fg.subtle" truncate>
                {key} (not found)
              </Text>
            </HStack>
          ))}
        </VStack>
      )}
    </Box>
  );
}

// ─── Compact display ──────────────────────────────────────────────

export default function LoadContextDisplay({ toolCallTuple }: DisplayProps) {
  const [toolCall, toolMessage] = toolCallTuple;

  let args: any = {};
  try {
    args = typeof toolCall.function?.arguments === 'string'
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function?.arguments || {};
  } catch {
    args = {};
  }

  const requestedCount = Array.isArray(args.keys) ? args.keys.length : 0;
  const isPending = toolMessage.content === '(executing...)';

  if (isPending) {
    return (
      <GridItem colSpan={12} my={1}>
        <HStack gap={1.5} py={1.5} px={2} bg="bg.elevated" borderRadius="md">
          <Icon
            as={LuLoader}
            boxSize={3}
            color="fg.muted"
            css={{ animation: 'spin 1s linear infinite', '@keyframes spin': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } } }}
          />
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            Loading context
          </Text>
        </HStack>
      </GridItem>
    );
  }

  const { success } = contentToDetails(toolMessage);

  if (!success) {
    return (
      <GridItem colSpan={12} my={1}>
        <HStack gap={2} px={2} py={1.5} bg="bg.elevated" borderRadius="md">
          <Icon as={LuX} boxSize={3} color="accent.danger" />
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            Failed to load context
          </Text>
        </HStack>
      </GridItem>
    );
  }

  let count = requestedCount;
  try {
    const parsed = JSON.parse(typeof toolMessage.content === 'string' ? toolMessage.content : '{}');
    if (Array.isArray(parsed?.docs)) count = parsed.docs.length;
  } catch {
    // keep requestedCount
  }

  return (
    <GridItem colSpan={12} my={1}>
      <HStack
        gap={1.5}
        py={1.5}
        px={2}
        bg="bg.subtle"
        borderRadius="md"
        border="1px solid"
        borderColor="border.default"
      >
        <Icon as={LuCheck} boxSize={3} color="accent.success" flexShrink={0} />
        <Text fontSize="xs" color="fg.muted" fontFamily="mono" whiteSpace="nowrap">
          Loaded context
        </Text>
        <HStack gap={1} bg="bg.subtle" px={1.5} py={0.5} borderRadius="sm">
          <Icon as={LuLibrary} boxSize={3} color="fg.default" />
          <Text fontSize="xs" color="fg.default" fontFamily="mono" fontWeight="600">
            {count === 1 ? '1 doc' : `${count} docs`}
          </Text>
        </HStack>
      </HStack>
    </GridItem>
  );
}
