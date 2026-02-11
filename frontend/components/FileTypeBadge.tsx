'use client';

import { HStack, Text } from '@chakra-ui/react';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import { FileType } from '@/lib/types';

export interface FileTypeBadgeProps {
  fileType: FileType | 'explore';
  size?: 'xs' | 'sm';
  opacity?: number
}

export default function FileTypeBadge({ fileType, size = 'xs', opacity = 1 }: FileTypeBadgeProps) {
  const metadata = getFileTypeMetadata(fileType);

  // Defensive check - should not happen now that explore is defined
  if (!metadata) {
    return null;
  }

  const TypeIcon = metadata.icon;

  const fontSize = size === 'xs' ? '2xs' : 'xs';
  const iconSize = size === 'xs' ? 10 : 12;
  const px = size === 'xs' ? 1.5 : 2;
  const py = size === 'xs' ? 0.5 : 1;

  return (
    <HStack
      gap={1}
      fontFamily="mono"
      fontSize={fontSize}
      fontWeight="600"
      color="white"
      px={px}
      py={py}
      bg={metadata.color}
      borderRadius="sm"
      flexShrink={0}
      opacity={opacity}
    >
      <TypeIcon size={iconSize} />
      <Text>{metadata.label}</Text>
    </HStack>
  );
}
