'use client';

import { Box, HStack, VStack, Text, Icon } from '@chakra-ui/react';
import { DbFile } from '@/lib/types';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';

type ViewMode = 'list' | 'grid';

interface FloatingDragGhostProps {
  files: DbFile[];
  draggedFileId: number | null;
  dragPosition: { x: number; y: number } | null;
  viewMode: ViewMode;
}

export default function FloatingDragGhost({ files, draggedFileId, dragPosition, viewMode }: FloatingDragGhostProps) {
  if (!draggedFileId || !dragPosition) return null;
  const draggedFile = files.find(f => f.id === draggedFileId);
  if (!draggedFile) return null;
  const metadata = getFileTypeMetadata(draggedFile.type);

  return (
    <Box
      position="fixed"
      left={`${dragPosition.x}px`}
      top={`${dragPosition.y}px`}
      transform="translate(-50%, -50%)"
      pointerEvents="none"
      zIndex={9999}
      transition="none"
    >
      {viewMode === 'list' ? (
        <HStack
          px={4}
          py={3}
          h="52px"
          bg="bg.surface"
          borderRadius="md"
          border="2px solid"
          borderColor="accent.teal"
          shadow="xl"
          minW="300px"
          gap={3}
        >
          <Icon
            as={metadata.icon}
            boxSize={5}
            color={metadata.color}
            flexShrink={0}
          />
          <Text
            fontWeight="500"
            fontSize="sm"
            color="fg.default"
            fontFamily="mono"
            overflow="hidden"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
          >
            {draggedFile.name}
          </Text>
        </HStack>
      ) : (
        <VStack
          p={4}
          bg="bg.surface"
          borderRadius="md"
          border="2px solid"
          borderColor="accent.teal"
          shadow="xl"
          align="center"
          gap={3}
          h="120px"
          w="180px"
          justify="center"
        >
          <Icon
            as={metadata.icon}
            boxSize={8}
            color={metadata.color}
          />
          <VStack gap={0.5} w="100%" align="center" minW={0}>
            <Text
              fontWeight="500"
              fontSize="sm"
              textAlign="center"
              w="100%"
              color="fg.default"
              overflow="hidden"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
              fontFamily="mono"
            >
              {draggedFile.name}
            </Text>
            <Text
              fontSize="2xs"
              color="fg.muted"
              fontFamily="mono"
              fontWeight="500"
              textTransform="uppercase"
              letterSpacing="0.05em"
              whiteSpace="nowrap"
            >
              {metadata.label}
            </Text>
          </VStack>
        </VStack>
      )}
    </Box>
  );
}
