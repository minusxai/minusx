'use client';

import { HStack, Text, Icon, GridItem } from '@chakra-ui/react';
import { LuCheck, LuX, LuFilePlus2 } from 'react-icons/lu';
import { DisplayProps, contentToDetails } from '@/lib/types';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import type { FileType } from '@/lib/ui/file-metadata';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

export default function CreateFileDisplay({ toolCallTuple, showThinking }: DisplayProps) {
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode');
  const [toolCall, toolMessage] = toolCallTuple;

  // Parse tool arguments
  let args: any = {};
  try {
    args = typeof toolCall.function?.arguments === 'string'
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function?.arguments || {};
  } catch {
    args = {};
  }

  const { file_type, name } = args;

  const { success } = contentToDetails(toolMessage);
  const id = undefined;  // CreateFile doesn't return an id in its result

  if (!success) {
    return showThinking ? (
      <GridItem colSpan={12} my={1}>
        <HStack gap={1.5} px={2} py={1.5} bg="accent.danger/10" borderRadius="md" border="1px solid" borderColor="accent.danger/20">
          <Icon as={LuX} boxSize={3} color="accent.danger" flexShrink={0} />
          <Text fontSize="xs" color="accent.danger" fontFamily="mono">
            Create failed
          </Text>
        </HStack>
      </GridItem>
    ) : null;
  }

  const color = 'accent.success';
  const meta = file_type ? getFileTypeMetadata(file_type as FileType) : null;
  const FileIcon = meta?.icon;
  const displayName = name || file_type || 'file';

  const href = id !== undefined
    ? `/f/${id}${mode ? `?mode=${mode}` : ''}`
    : undefined;

  return (
    <GridItem colSpan={12} my={1}>
      <HStack
        gap={1.5}
        py={1.5}
        px={2}
        bg={`${color}/10`}
        borderRadius="md"
        border="1px solid"
        borderColor={`${color}/20`}
        flexWrap="wrap"
      >
        <Icon as={LuCheck} boxSize={3} color={color} flexShrink={0} />
        <Icon as={LuFilePlus2} boxSize={3} color={color} flexShrink={0} />
        <Text fontSize="xs" color={color} fontFamily="mono">
          Created {file_type || 'file'}
        </Text>
        {href ? (
          <Link href={href}>
            <HStack
              gap={1}
              bg={`${color}/15`}
              px={1.5}
              py={0.5}
              borderRadius="sm"
              cursor="pointer"
              _hover={{ bg: `${color}/25` }}
            >
              {FileIcon && <Icon as={FileIcon} boxSize={2.5} color={color} />}
              <Text fontSize="xs" color="fg.default" fontFamily="mono" fontWeight="600">
                {displayName}
              </Text>
            </HStack>
          </Link>
        ) : (
          <Text fontSize="xs" color="fg.default" fontFamily="mono" fontWeight="600">
            {displayName}
          </Text>
        )}
      </HStack>
    </GridItem>
  );
}
