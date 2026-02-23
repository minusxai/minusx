'use client';

import React from 'react';
import { Box, Grid, GridItem, HStack, Text } from '@chakra-ui/react';
import { ChatMessage as ChatMessageType, MessageDebugInfo, CompletedToolCall } from '@/lib/types';
import ToolCallDisplay from './ToolCallDisplay';
import DebugInfoDisplay from './DebugInfoDisplay';
import Markdown from '../Markdown';
import { MessageWithMentions } from '../chat/MessageWithMentions';
import { useAppSelector } from '@/store/hooks';
import { cloneDeep, isEmpty } from 'lodash';
import { parseThinkingAnswer } from '@/lib/utils/xml-parser';
import { MessageWithFlags } from './message/messageHelpers';
import { LuChevronRight, LuChevronDown } from 'react-icons/lu';


interface ChatMessageProps {
  message: MessageWithFlags;
  databaseName?: string;
  isCompact?: boolean;
  showThinking: boolean;
  toggleShowThinking: () => void;
  markdownContext?: 'sidebar' | 'mainpage';
}

export default function SimpleChatMessage({ message, databaseName, isCompact = false, showThinking = false, toggleShowThinking, markdownContext = 'mainpage' }: ChatMessageProps) {
  // Handle debug messages (admin-only) - only show if there are LLM calls
  if (message.role === 'debug') {
    const debugInfo = message as any as MessageDebugInfo;
    // Skip rendering if no LLM calls (empty debug info)
    if (!debugInfo.llmDebug || debugInfo.llmDebug.length === 0) {
      return null;
    }
    return (
      <DebugInfoDisplay debugInfo={debugInfo} />
    );
  }

  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  const hasContent = !!message.content && JSON.stringify(message.content).trim().length > 0;
  const userColSpan = isCompact ? 12 : { base: 12, md: 8 };
  const userColStart = isCompact ? 1 : { base: 1, md: 5};

  if (isUser) {
    return(
    <Grid
      templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }}
      gap={2}
      w="100%"
    >
      {hasContent && (
        <>
          <GridItem
            colSpan={userColSpan}
            colStart={userColStart}
          >
            <Box
              p={3}
            //   bg={'accent.teal/70'}
              bg={'bg.emphasis'}
              borderRadius={'md'}
              minW={'100px'}
            >
              <MessageWithMentions
                content={message.content || ''}
                context={markdownContext}
                textAlign="left"
              />
            </Box>
          </GridItem>
          <GridItem
            colSpan={12}
            colStart={1}
          >
            <HStack
              mt={1}
              cursor="pointer"
              onClick={toggleShowThinking}
              _hover={{ opacity: 0.8 }}
              color="fg.subtle"
              fontSize="sm"
              w="fit-content"
            >
              {showThinking ? <LuChevronDown size={16} /> : <LuChevronRight size={16} />}
              <Text>{showThinking ? "Hide" : "Show"} Thinking</Text>
            </HStack>
          </GridItem>
        </>
      )}
    </Grid>)
  }
  if (isTool) {
    // Parse arguments field if it's a string
    let functionArgs: Record<string, any>;
    if (typeof message.function.arguments === 'string') {
      try {
        functionArgs = JSON.parse(message.function.arguments);
      } catch (e) {
        console.warn('[SimpleChatMessage] Failed to parse function arguments JSON:', e);
        // Default to empty object if parsing fails
        functionArgs = {};
      }
    } else {
      functionArgs = message.function.arguments;
    }

    const toolCallTuple: CompletedToolCall = [{
        id: message.tool_call_id,
        type: 'function',
        function: {
            name: message.function.name,
            arguments: functionArgs
        }
    }, {
        role: 'tool',
        tool_call_id: message.tool_call_id,
        content: message.content
    }]
    return (
        <Grid
        templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }}
        gap={2}
        w="100%"
        >
            <ToolCallDisplay key={message.tool_call_id} toolCallTuple={toolCallTuple} databaseName={databaseName} isCompact={isCompact} showThinking={showThinking} markdownContext={markdownContext}/>
        </Grid>
    )
  }
}
