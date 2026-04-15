'use client';

import { HStack, Text, Icon, GridItem } from '@chakra-ui/react';
import { LuCheck, LuX, LuFile, LuFolder, LuFilePlus2, LuArrowRight } from 'react-icons/lu';
import { DisplayProps, ToolCallDetails, contentToDetails } from '@/lib/types';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

export default function NavigateDisplay({ toolCallTuple }: DisplayProps) {
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

  const { file_id, path, newFileType } = args;

  // Still executing (placeholder from messageHelpers) — render nothing until complete
  if (toolMessage.content === '(executing...)') return null;

  const details = contentToDetails<ToolCallDetails & { message?: string }>(toolMessage);
  const { success } = details;
  // `message` lives in content, `error` lives in details — check both
  const failMessage = details.message || details.error;

  // Failed / declined navigation
  if (!success) {
    return (
      <GridItem colSpan={12} my={1}>
        <HStack
          gap={1.5}
          py={1.5}
          px={2}
          bg="bg.elevated"
          borderRadius="md"
          border="1px solid"
          borderColor="border.default"
          flexWrap="wrap"
        >
          <Icon as={LuX} boxSize={3} color="fg.muted" flexShrink={0} />
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            {failMessage || 'User declined navigation'}
          </Text>
        </HStack>
      </GridItem>
    );
  }

  // Helper to append mode param if present
  const withMode = (url: string) => {
    if (!mode) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}mode=${mode}`;
  };

  // Determine navigation type, label and href
  const getNavInfo = () => {
    if (file_id !== undefined) {
      return { icon: LuFile, label: `File #${file_id}`, href: withMode(`/f/${file_id}`) };
    }
    if (newFileType !== undefined) {
      const baseHref = path ? `/new/${newFileType}?folder=${encodeURIComponent(path)}` : `/new/${newFileType}`;
      return { icon: LuFilePlus2, label: `New ${newFileType}`, href: withMode(baseHref) };
    }
    if (path !== undefined) {
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      return { icon: LuFolder, label: path, href: withMode(`/p/${cleanPath}`) };
    }
    return { icon: LuArrowRight, label: 'Unknown', href: null };
  };

  const { icon, label, href } = getNavInfo();

  return (
    <GridItem colSpan={12} my={1}>
      <HStack
        gap={1.5}
        py={1.5}
        px={2}
        bg="accent.success/10"
        borderRadius="md"
        border="1px solid"
        borderColor="accent.success/20"
        flexWrap="wrap"
      >
        <Icon as={LuCheck} boxSize={3} color="accent.success" flexShrink={0} />
        <Text fontSize="xs" color="accent.success" fontFamily="mono" whiteSpace="nowrap">
          Navigated to
        </Text>
        <HStack
          gap={1}
          bg="bg.subtle"
          px={1.5}
          py={0.5}
          borderRadius="sm"
          cursor={href ? 'pointer' : 'default'}
          _hover={href ? { bg: 'bg.muted' } : {}}
          {...(href ? { as: Link, href } : {})}
        >
          <Icon as={icon} boxSize={3} color="fg.default" />
          <Text fontSize="xs" color="fg.default" fontFamily="mono" fontWeight="600">
            {label}
          </Text>
        </HStack>
      </HStack>
    </GridItem>
  );
}
