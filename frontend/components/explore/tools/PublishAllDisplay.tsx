'use client';

import { HStack, Text, Icon, GridItem } from '@chakra-ui/react';
import { LuCheck, LuX, LuUpload } from 'react-icons/lu';
import { DisplayProps, contentToDetails } from '@/lib/types';

export default function PublishAllDisplay({ toolCallTuple, showThinking }: DisplayProps) {
  const [, toolMessage] = toolCallTuple;

  const { success, message } = contentToDetails(toolMessage);

  if (!success) {
    return showThinking ? (
      <GridItem colSpan={12} my={1}>
        <HStack gap={1.5} px={2} py={1.5} bg="accent.danger/10" borderRadius="md" border="1px solid" borderColor="accent.danger/20">
          <Icon as={LuX} boxSize={3} color="accent.danger" flexShrink={0} />
          <Text fontSize="xs" color="accent.danger" fontFamily="mono">
            {message || 'Publish cancelled'}
          </Text>
        </HStack>
      </GridItem>
    ) : null;
  }

  const color = 'fg.muted';

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
        <Icon as={LuCheck} boxSize={3} color={color} flexShrink={0} />
        <Icon as={LuUpload} boxSize={3} color={color} flexShrink={0} />
        <Text fontSize="xs" color={color} fontFamily="mono">
          {message || 'Published successfully'}
        </Text>
      </HStack>
    </GridItem>
  );
}
