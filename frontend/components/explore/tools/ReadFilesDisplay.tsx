'use client';

import { useMemo } from 'react';
import { HStack, Text, Icon, GridItem } from '@chakra-ui/react';
import { LuCheck, LuX, LuBookOpen } from 'react-icons/lu';
import { DisplayProps, contentToDetails } from '@/lib/types';
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

  // Select the stable files dictionary; derive the array with useMemo to avoid new object
  // references in the selector (which would cause Redux to warn about unnecessary re-renders)
  const filesDict = useAppSelector(state => state.files.files);
  const fileInfos = useMemo(() =>
    fileIds.map(id => ({
      id,
      name: filesDict[id]?.name ?? null,
      type: (filesDict[id]?.type ?? null) as FileType | null,
    })),
    [fileIds, filesDict]
  );

  const { success } = contentToDetails(toolMessage);

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
