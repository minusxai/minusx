'use client';

import { Box, HStack, VStack, Text, Icon, GridItem } from '@chakra-ui/react';
import { LuCheck, LuX, LuFile, LuFolder, LuFilePlus2, LuArrowRight } from 'react-icons/lu';
import { DisplayProps, ToolCallDetails, contentToDetails } from '@/lib/types';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type DetailCardProps, parseToolArgs, isToolSuccess } from './DetailCarousel';
import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '@/store/store';
import { makeSelectConversationByToolCallId } from '@/store/chatSlice';
import UserInputComponent from '../UserInputComponent';

// ─── Detail card for AgentTurnContainer carousel ──────────────────

export function NavigateDetailCard({ msg, filesDict }: DetailCardProps) {
  const toolMsg = msg as any;
  const toolCallId = toolMsg.tool_call_id;
  const args = parseToolArgs(msg);
  const success = isToolSuccess(msg);
  const { file_id, path, newFileType } = args;

  // Check for pending user input (navigation confirmation)
  const selectConversation = useMemo(() => makeSelectConversationByToolCallId(), []);
  const conversation = useSelector((state: RootState) => selectConversation(state, toolCallId));
  const pendingTool = conversation?.pending_tool_calls.find(p => p.toolCall.id === toolCallId);
  const pendingUserInputs = pendingTool?.userInputs?.filter(ui => ui.result === undefined);

  if (pendingUserInputs && pendingUserInputs.length > 0 && conversation) {
    return (
      <Box mx={3} mb={2}>
        {pendingUserInputs.map(userInput => (
          <UserInputComponent
            key={userInput.id}
            conversationID={conversation.conversationID}
            tool_call_id={toolCallId}
            userInput={userInput}
            toolName={toolMsg.function?.name}
            toolArgs={args}
          />
        ))}
      </Box>
    );
  }

  let navIcon = LuArrowRight;
  let label = 'Unknown';
  let href: string | null = null;
  if (file_id !== undefined) {
    navIcon = LuFile;
    label = filesDict[file_id]?.name || `File #${file_id}`;
    href = `/f/${file_id}`;
  } else if (newFileType !== undefined) {
    navIcon = LuFilePlus2;
    label = `New ${newFileType}`;
    href = null;
  } else if (path !== undefined) {
    navIcon = LuFolder;
    label = path;
    href = `/p/${path.startsWith('/') ? path.slice(1) : path}`;
  }

  return (
    <Box mx={3} mb={2} p={3} bg="bg.subtle" borderRadius="md" border="1px solid" borderColor="border.default"
      {...(href && success ? {
        as: Link, href, cursor: 'pointer',
        _hover: { borderColor: 'accent.teal', bg: 'bg.muted' }, transition: 'all 0.15s',
      } : {})}
    >
      <HStack gap={2}>
        <Icon as={success ? navIcon : LuX} boxSize={4} color={success ? 'fg.muted' : 'accent.danger'} />
        <VStack gap={0} align="start" flex={1} minW={0}>
          <Text fontSize="sm" fontFamily="mono" color="fg.default" fontWeight="600" truncate w="full">
            {label}
          </Text>
          {href && (
            <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" truncate w="full">
              {href}
            </Text>
          )}
        </VStack>
        <Box bg={success ? 'accent.teal/10' : 'accent.danger/10'} px={2} py={0.5} borderRadius="full" flexShrink={0}>
          <Text fontSize="2xs" fontFamily="mono" color={success ? 'accent.teal' : 'accent.danger'} fontWeight="500">
            {success ? 'Navigated' : 'Failed'}
          </Text>
        </Box>
      </HStack>
    </Box>
  );
}

// ─── Compact display (existing) ───────────────────────────────────

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
        bg="bg.subtle"
        borderRadius="md"
        border="1px solid"
        borderColor="border.default"
        flexWrap="wrap"
      >
        <Icon as={LuCheck} boxSize={3} color="accent.success" flexShrink={0} />
        <Text fontSize="xs" color="fg.muted" fontFamily="mono" whiteSpace="nowrap">
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
