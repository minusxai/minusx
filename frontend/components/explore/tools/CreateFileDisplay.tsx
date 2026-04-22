'use client';

import { Box, HStack, VStack, Text, Icon, GridItem } from '@chakra-ui/react';
import { LuCheck, LuX, LuFilePlus2 } from 'react-icons/lu';
import { DisplayProps, contentToDetails } from '@/lib/types';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import type { FileType } from '@/lib/ui/file-metadata';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type DetailCardProps, parseToolArgs, isToolSuccess, parseToolContent } from './DetailCarousel';

// ─── Shared file detail card (used by created/edited/read) ───────

export function FileDetailCard({ msg, filesDict }: DetailCardProps) {
  const args = parseToolArgs(msg);
  const content = parseToolContent(msg);
  const success = isToolSuccess(msg);

  // Extract file info from response content
  const fileState = content?.state?.fileState || content?.fileState || content?.files?.[0]?.fileState;
  const fileName = fileState?.name || args.name || null;
  const filePath = fileState?.path || null;
  const fileType = (fileState?.type || args.file_type || null) as FileType | null;
  const assetCount = fileState?.content?.assets?.filter((a: any) => a.type === 'question')?.length ?? null;

  // Get fileId for linking
  let fileId: number | null = args.fileId || args.fileIds?.[0] || null;
  if (!fileId) {
    fileId = fileState?.id || content?.state?.fileState?.id || null;
  }

  // Fallback name from Redux
  const name = fileName || (fileId && filesDict[fileId]?.name) || (fileId ? `#${fileId}` : fileType || 'file');
  const meta = fileType ? getFileTypeMetadata(fileType) : null;
  const canLink = fileId != null && fileId > 0;

  return (
    <Box
      mx={3} mb={2} p={3} bg="bg.subtle" borderRadius="md" border="1px solid" borderColor="border.default"
      {...(canLink ? {
        as: Link, href: `/f/${fileId}`, cursor: 'pointer',
        _hover: { borderColor: 'accent.teal', bg: 'bg.muted' }, transition: 'all 0.15s',
      } : {})}
    >
      <HStack gap={2}>
        <Icon as={meta?.icon || LuCheck} boxSize={4} color={meta?.color || (success ? 'fg.muted' : 'accent.danger')} />
        <VStack gap={0} align="start" flex={1} minW={0}>
          <Text fontSize="sm" fontFamily="mono" color="fg.default" fontWeight="600" truncate w="full">
            {name}
          </Text>
          {filePath && (
            <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" truncate w="full">
              {filePath}
            </Text>
          )}
        </VStack>
        {meta && (
          <Box bg={`${meta.color}/10`} px={2} py={0.5} borderRadius="full" flexShrink={0}>
            <Text fontSize="2xs" fontFamily="mono" color={meta.color} fontWeight="500">
              {meta.label}
            </Text>
          </Box>
        )}
      </HStack>
      {assetCount != null && assetCount > 0 && (
        <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" mt={1} pl={6}>
          {assetCount} {assetCount === 1 ? 'question' : 'questions'}
        </Text>
      )}
    </Box>
  );
}

// ─── Compact display (existing) ───────────────────────────────────

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

  const accent = 'accent.success';
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
        bg={`${accent}/8`}
        borderRadius="md"
        border="1px solid"
        borderColor={`${accent}/15`}
        flexWrap="wrap"
      >
        <Icon as={LuCheck} boxSize={3} color={accent} flexShrink={0} />
        <Icon as={LuFilePlus2} boxSize={3} color={accent} flexShrink={0} />
        <Text fontSize="xs" color="fg.muted" fontFamily="mono">
          Created {file_type || 'file'}
        </Text>
        {href ? (
          <Link href={href}>
            <HStack
              gap={1}
              bg={`${accent}/10`}
              px={1.5}
              py={0.5}
              borderRadius="sm"
              cursor="pointer"
              _hover={{ bg: `${accent}/20` }}
            >
              {FileIcon && <Icon as={FileIcon} boxSize={2.5} color="fg.muted" />}
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
