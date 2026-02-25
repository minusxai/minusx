'use client';

import { HStack, Text, Icon, GridItem } from '@chakra-ui/react';
import { LuCheck, LuX, LuBookOpen } from 'react-icons/lu';
import { DisplayProps } from '@/lib/types';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import type { FileType } from '@/lib/ui/file-metadata';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAppSelector } from '@/store/hooks';

export default function ReadFilesDisplay({ toolCallTuple, showThinking }: DisplayProps) {
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

  const fileIds: number[] = args.fileIds || [];

  // Get file info from Redux store
  const fileInfos = useAppSelector(state => {
    return fileIds.map(id => {
      const file = state.files.files[id];
      return {
        id,
        name: file?.name || null,
        type: (file?.type || null) as FileType | null,
      };
    });
  });

  // Parse result - ReadFiles returns an array of file objects
  let result: any;
  try {
    result = typeof toolMessage.content === 'string'
      ? JSON.parse(toolMessage.content)
      : toolMessage.content;
  } catch {
    result = null;
  }

  const success = Array.isArray(result) && result.length > 0;

  if (!success) {
    return showThinking ? (
      <GridItem colSpan={12} my={1}>
        <HStack gap={1.5} px={2} py={1.5} bg="accent.danger/10" borderRadius="md" border="1px solid" borderColor="accent.danger/20">
          <Icon as={LuX} boxSize={3} color="accent.danger" flexShrink={0} />
          <Text fontSize="xs" color="accent.danger" fontFamily="mono">
            Read files failed
          </Text>
        </HStack>
      </GridItem>
    ) : null;
  }

  const withMode = (url: string) => {
    if (!mode) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}mode=${mode}`;
  };

  const color = 'accent.primary';

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
        <Icon as={LuBookOpen} boxSize={3} color={color} flexShrink={0} />
        <Text fontSize="xs" color={color} fontFamily="mono">
          Read
        </Text>
        {fileInfos.map(({ id, name, type }) => {
          const meta = type ? getFileTypeMetadata(type) : null;
          const FileIcon = meta?.icon;
          return (
            <Link key={id} href={withMode(`/f/${id}`)}>
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
                <Text fontSize="xs" color="fg.default" fontFamily="mono" fontWeight="500">
                  {name || `#${id}`}
                </Text>
              </HStack>
            </Link>
          );
        })}
      </HStack>
    </GridItem>
  );
}
