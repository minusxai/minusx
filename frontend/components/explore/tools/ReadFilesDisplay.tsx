'use client';

import { useMemo } from 'react';
import { Box, HStack, VStack, Text, Icon, GridItem } from '@chakra-ui/react';
import { LuCheck, LuX, LuBookOpen } from 'react-icons/lu';
import { DisplayProps, contentToDetails } from '@/lib/types';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import type { FileType } from '@/lib/ui/file-metadata';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAppSelector } from '@/store/hooks';
import { type DetailCardProps, parseToolArgs, parseToolContent, isToolSuccess } from './DetailCarousel';

// ─── Detail card for AgentTurnContainer carousel ──────────────────

export function ReadFilesDetailCard({ msg, filesDict }: DetailCardProps) {
  const args = parseToolArgs(msg);
  const content = parseToolContent(msg);
  const success = isToolSuccess(msg);
  const fileIds: number[] = args.fileIds || [];

  const files = fileIds.map(id => {
    const file = filesDict[id];
    const type = (file?.type ?? null) as FileType | null;
    const meta = type ? getFileTypeMetadata(type) : null;
    const isNewFile = id < 0;
    const name = isNewFile ? `New ${meta?.label ?? type ?? 'file'}` : (file?.name ?? `#${id}`);
    return { id, name, meta, isNewFile, canLink: !isNewFile && id > 0 };
  });

  // Single file: show as a full card
  if (files.length === 1) {
    const f = files[0];
    return (
      <Box
        mx={3} mb={2} p={3} bg="bg.subtle" borderRadius="md" border="1px solid" borderColor="border.default"
        {...(f.canLink ? {
          as: Link, href: `/f/${f.id}`, cursor: 'pointer',
          _hover: { borderColor: 'accent.teal', bg: 'bg.muted' }, transition: 'all 0.15s',
        } : {})}
      >
        <HStack gap={2}>
          <Icon as={f.meta?.icon || LuBookOpen} boxSize={4} color={success ? (f.meta?.color || 'fg.muted') : 'accent.danger'} />
          <Text fontSize="sm" fontFamily="mono" color="fg.default" fontWeight="600" truncate flex={1}>
            {f.name}
          </Text>
          {f.meta && (
            <Box bg={`${f.meta.color}/10`} px={2} py={0.5} borderRadius="full" flexShrink={0}>
              <Text fontSize="2xs" fontFamily="mono" color={f.meta.color} fontWeight="500">
                {f.meta.label}
              </Text>
            </Box>
          )}
        </HStack>
      </Box>
    );
  }

  // Multiple files: show as a list
  return (
    <VStack gap={1} align="stretch" mx={3} mb={2}>
      {files.map(f => (
        <Box
          key={f.id} p={2} bg="bg.subtle" borderRadius="md" border="1px solid" borderColor="border.default"
          {...(f.canLink ? {
            as: Link, href: `/f/${f.id}`, cursor: 'pointer',
            _hover: { borderColor: 'accent.teal', bg: 'bg.muted' }, transition: 'all 0.15s',
          } : {})}
        >
          <HStack gap={2}>
            <Icon as={f.meta?.icon || LuBookOpen} boxSize={3.5} color={f.meta?.color || 'fg.muted'} flexShrink={0} />
            <Text fontSize="xs" fontFamily="mono" color="fg.default" fontWeight="600" truncate flex={1}>
              {f.name}
            </Text>
            {f.meta && (
              <Box bg={`${f.meta.color}/10`} px={1.5} py={0.5} borderRadius="full" flexShrink={0}>
                <Text fontSize="2xs" fontFamily="mono" color={f.meta.color} fontWeight="500">
                  {f.meta.label}
                </Text>
              </Box>
            )}
          </HStack>
        </Box>
      ))}
    </VStack>
  );
}

// ─── Compact display (existing) ───────────────────────────────────

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
          const isNewFile = id < 0;
          const displayName = isNewFile
            ? `a new ${meta?.label ?? type ?? 'file'}`
            : name || `#${id}`;

          const chip = (
            <HStack
              gap={1}
              bg="bg.muted"
              px={1.5}
              py={0.5}
              borderRadius="sm"
              cursor={isNewFile ? 'default' : 'pointer'}
              _hover={isNewFile ? {} : { bg: 'bg.emphasized' }}
            >
              {FileIcon && <Icon as={FileIcon} boxSize={2.5} color={color} />}
              <Text fontSize="xs" color="fg.default" fontFamily="mono" fontWeight="500">
                {displayName}
              </Text>
            </HStack>
          );

          return isNewFile ? (
            <span key={id}>{chip}</span>
          ) : (
            <Link key={id} href={withMode(`/f/${id}`)}>
              {chip}
            </Link>
          );
        })}
      </HStack>
    </GridItem>
  );
}
