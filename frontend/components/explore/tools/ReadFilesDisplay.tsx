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

  // Parse files from response content first (has name, type, path), fall back to args + Redux
  const responseFiles: any[] = content?.files || [];
  const fileIds: number[] = args.fileIds || [];

  const files = responseFiles.length > 0
    ? responseFiles.map((f: any) => {
        const fs = f.fileState || {};
        const id = fs.id ?? 0;
        const type = (fs.type ?? null) as FileType | null;
        const meta = type ? getFileTypeMetadata(type) : null;
        const name = fs.name || (filesDict[id]?.name) || `#${id}`;
        const path = fs.path || null;
        const assetCount = fs.content?.assets?.filter((a: any) => a.type === 'question')?.length ?? null;
        return { id, name, path, meta, assetCount, canLink: id > 0 };
      })
    : fileIds.map(id => {
        const file = filesDict[id];
        const type = (file?.type ?? null) as FileType | null;
        const meta = type ? getFileTypeMetadata(type) : null;
        const isNewFile = id < 0;
        const name = isNewFile ? `New ${meta?.label ?? type ?? 'file'}` : (file?.name ?? `#${id}`);
        return { id, name, path: null as string | null, meta, assetCount: null as number | null, canLink: !isNewFile && id > 0 };
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
          <VStack gap={0} align="start" flex={1} minW={0}>
            <Text fontSize="sm" fontFamily="mono" color="fg.default" fontWeight="600" truncate w="full">
              {f.name}
            </Text>
            {f.path && (
              <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" truncate w="full">
                {f.path}
              </Text>
            )}
          </VStack>
          {f.meta && (
            <Box bg={`${f.meta.color}/10`} px={2} py={0.5} borderRadius="full" flexShrink={0}>
              <Text fontSize="2xs" fontFamily="mono" color={f.meta.color} fontWeight="500">
                {f.meta.label}
              </Text>
            </Box>
          )}
        </HStack>
        {f.assetCount != null && f.assetCount > 0 && (
          <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" mt={1} pl={6}>
            {f.assetCount} {f.assetCount === 1 ? 'question' : 'questions'}
          </Text>
        )}
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
            <VStack gap={0} align="start" flex={1} minW={0}>
              <Text fontSize="xs" fontFamily="mono" color="fg.default" fontWeight="600" truncate w="full">
                {f.name}
              </Text>
              {f.path && (
                <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" truncate w="full">
                  {f.path}
                </Text>
              )}
            </VStack>
            {f.meta && (
              <Box bg={`${f.meta.color}/10`} px={1.5} py={0.5} borderRadius="full" flexShrink={0}>
                <Text fontSize="2xs" fontFamily="mono" color={f.meta.color} fontWeight="500">
                  {f.meta.label}
                </Text>
              </Box>
            )}
          </HStack>
          {f.assetCount != null && f.assetCount > 0 && (
            <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" mt={0.5} pl={5.5}>
              {f.assetCount} {f.assetCount === 1 ? 'question' : 'questions'}
            </Text>
          )}
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

  const accent = 'accent.primary';

  return (
    <GridItem colSpan={12} my={1}>
      <HStack
        gap={1.5}
        py={1.5}
        px={2}
        bg={`${accent}/8`}
        borderRadius="md"
        border="1px solid"
        borderColor={`${accent}/15`}
        flexWrap="wrap"
      >
        <Icon as={LuCheck} boxSize={3} color={accent} flexShrink={0} />
        <Icon as={LuBookOpen} boxSize={3} color={accent} flexShrink={0} />
        <Text fontSize="xs" color="fg.muted" fontFamily="mono">
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
              {FileIcon && <Icon as={FileIcon} boxSize={2.5} color="fg.muted" />}
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
