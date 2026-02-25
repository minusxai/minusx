'use client';

import { useState } from 'react';
import { HStack, VStack, Text, Icon, GridItem, Box } from '@chakra-ui/react';
import { LuCheck, LuX, LuPencilLine, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import { DisplayProps } from '@/lib/types';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import type { FileType } from '@/lib/ui/file-metadata';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAppSelector } from '@/store/hooks';

export default function EditFileDisplay({ toolCallTuple, showThinking }: DisplayProps) {
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode');
  const [toolCall, toolMessage] = toolCallTuple;
  const [isExpanded, setIsExpanded] = useState(false);

  // Parse tool arguments
  let args: any = {};
  try {
    args = typeof toolCall.function?.arguments === 'string'
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function?.arguments || {};
  } catch {
    args = {};
  }

  const { fileId } = args;

  // Get file info from Redux store
  const fileInfo = useAppSelector(state => {
    if (fileId === undefined) return null;
    const file = state.files.files[fileId];
    if (!file) return null;
    return {
      name: file.name || null,
      type: (file.type || null) as FileType | null,
    };
  });

  // Parse result
  let result: any;
  try {
    result = typeof toolMessage.content === 'string'
      ? JSON.parse(toolMessage.content)
      : toolMessage.content;
  } catch {
    result = { success: false };
  }

  const { success, error, diff } = result;

  const color = 'accent.secondary';

  if (!success) {
    return showThinking ? (
      <GridItem colSpan={12} my={1}>
        <HStack gap={1.5} px={2} py={1.5} bg="accent.danger/10" borderRadius="md" border="1px solid" borderColor="accent.danger/20">
          <Icon as={LuX} boxSize={3} color="accent.danger" flexShrink={0} />
          <Text fontSize="xs" color="accent.danger" fontFamily="mono">
            Edit failed{error ? `: ${error}` : ''}
          </Text>
        </HStack>
      </GridItem>
    ) : null;
  }

  const href = fileId !== undefined
    ? `/f/${fileId}${mode ? `?mode=${mode}` : ''}`
    : undefined;

  const displayName = fileInfo?.name || (fileId !== undefined ? `#${fileId}` : 'file');
  const meta = fileInfo?.type ? getFileTypeMetadata(fileInfo.type) : null;
  const FileIcon = meta?.icon;

  // Parse diff for display
  const diffLines = diff ? String(diff).split('\n').filter((l: string) => l.startsWith('+') || l.startsWith('-')) : [];
  const hasDiff = diffLines.length > 0;

  return (
    <GridItem colSpan={12} my={1}>
      <Box
        bg={`${color}/10`}
        borderRadius="md"
        border="1px solid"
        borderColor={`${color}/20`}
        overflow="hidden"
      >
        <HStack
          gap={1.5}
          py={1.5}
          px={2}
          flexWrap="wrap"
          cursor={hasDiff ? 'pointer' : 'default'}
          onClick={() => hasDiff && setIsExpanded(!isExpanded)}
        >
          {hasDiff && (
            <Icon as={isExpanded ? LuChevronDown : LuChevronRight} boxSize={3} color={color} flexShrink={0} />
          )}
          {!hasDiff && (
            <Icon as={LuCheck} boxSize={3} color={color} flexShrink={0} />
          )}
          <Icon as={LuPencilLine} boxSize={3} color={color} flexShrink={0} />
          <Text fontSize="xs" color={color} fontFamily="mono">
            Edited
          </Text>
          {fileId !== undefined && href && (
            <Link href={href} onClick={(e) => e.stopPropagation()}>
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
          )}
        </HStack>

        {/* Expandable diff */}
        {isExpanded && hasDiff && (
          <Box px={2} pb={2}>
            <VStack gap={0} align="stretch" borderRadius="sm" overflow="hidden" border="1px solid" borderColor="border.default">
              {diffLines.slice(0, 8).map((line: string, i: number) => {
                const isAdd = line.startsWith('+');
                return (
                  <Box
                    key={i}
                    px={2}
                    py={0.5}
                    bg={isAdd ? 'green.subtle' : 'red.subtle'}
                    fontFamily="mono"
                    fontSize="xs"
                    whiteSpace="pre"
                    overflow="hidden"
                    textOverflow="ellipsis"
                  >
                    <Text as="span" color={isAdd ? 'green.fg' : 'red.fg'}>
                      {line}
                    </Text>
                  </Box>
                );
              })}
              {diffLines.length > 8 && (
                <Box px={2} py={0.5} bg="bg.subtle">
                  <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                    ...{diffLines.length - 8} more lines
                  </Text>
                </Box>
              )}
            </VStack>
          </Box>
        )}
      </Box>
    </GridItem>
  );
}
