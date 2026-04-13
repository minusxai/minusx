'use client';

import React, { useState } from 'react';
import { Box, Grid, GridItem, HStack, Text, IconButton, Textarea } from '@chakra-ui/react';
import { ChatMessage as ChatMessageType, MessageDebugInfo, CompletedToolCall } from '@/lib/types';
import ToolCallDisplay from './ToolCallDisplay';
import DebugInfoDisplay from './DebugInfoDisplay';
import Markdown from '../Markdown';
import { MessageWithMentions } from '../chat/MessageWithMentions';
import { useAppSelector } from '@/store/hooks';
import { useAppDispatch } from '@/store/hooks';
import { cloneDeep, isEmpty } from 'lodash';
import { parseThinkingAnswer } from '@/lib/utils/xml-parser';
import { MessageWithFlags } from './message/messageHelpers';
import { LuChevronRight, LuChevronDown, LuPencil, LuCheck, LuX } from 'react-icons/lu';
import { editAndForkMessage } from '@/store/chatSlice';


interface ChatMessageProps {
  message: MessageWithFlags;
  databaseName?: string;
  isCompact?: boolean;
  showThinking: boolean;
  toggleShowThinking: () => void;
  markdownContext?: 'sidebar' | 'mainpage';
  conversationID?: number;
}

const SimpleChatMessage = React.memo(function SimpleChatMessage({ message, databaseName, isCompact = false, showThinking = false, toggleShowThinking, markdownContext = 'mainpage', conversationID }: ChatMessageProps) {
  const dispatch = useAppDispatch();
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [isHovered, setIsHovered] = useState(false);
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
  const hasContent = !!message.content && (
    typeof message.content === 'string' ? message.content.trim().length > 0 : true
  );
  const userColSpan = isCompact ? 12 : { base: 12, md: 8 };
  const userColStart = isCompact ? 1 : { base: 1, md: 5};

  if (isUser) {
    const userMsg = message as import('@/store/chatSlice').UserMessage;
    const imageAttachments = userMsg.attachments?.filter(a => a.type === 'image' && !a.metadata?.auto) ?? [];
    const canEdit = conversationID !== undefined && userMsg.logIndex !== undefined;

    const handleEditConfirm = () => {
      if (!editText.trim() || conversationID === undefined || userMsg.logIndex === undefined) return;
      dispatch(editAndForkMessage({
        conversationID,
        logIndex: userMsg.logIndex,
        message: editText.trim(),
      }));
      setIsEditing(false);
    };

    const handleEditCancel = () => {
      setIsEditing(false);
      setEditText('');
    };

    return(
    <Grid
      templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }}
      gap={2}
      w="100%"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {hasContent && (
        <>
          <GridItem
            colSpan={userColSpan}
            colStart={userColStart}
          >
            {isEditing ? (
              <Box>
                <Textarea
                  aria-label="Edit message"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleEditConfirm();
                    } else if (e.key === 'Escape') {
                      handleEditCancel();
                    }
                  }}
                  autoFocus
                  minH="60px"
                  fontSize="sm"
                />
                <HStack mt={1} gap={2} justify="flex-end">
                  <IconButton
                    aria-label="Confirm edit"
                    size="xs"
                    colorPalette="green"
                    variant="solid"
                    onClick={handleEditConfirm}
                  >
                    <LuCheck />
                  </IconButton>
                  <IconButton
                    aria-label="Cancel edit"
                    size="xs"
                    variant="ghost"
                    onClick={handleEditCancel}
                  >
                    <LuX />
                  </IconButton>
                </HStack>
              </Box>
            ) : (
              <Box
                p={3}
                bg={'bg.emphasis'}
                borderRadius={'md'}
                minW={'100px'}
                position="relative"
              >
                <MessageWithMentions
                  content={message.content || ''}
                  context={markdownContext}
                  textAlign="left"
                />
                {imageAttachments.length > 0 && (
                  <HStack mt={2} gap={2} flexWrap="wrap">
                    {imageAttachments.map((att, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={att.content}
                        alt={att.name}
                        aria-label={`Attached image: ${att.name}`}
                        style={{
                          maxWidth: 200,
                          maxHeight: 150,
                          borderRadius: 6,
                          objectFit: 'cover',
                          cursor: 'pointer',
                        }}
                        onClick={() => window.open(att.content, '_blank')}
                      />
                    ))}
                  </HStack>
                )}
                {canEdit && isHovered && (
                  <IconButton
                    aria-label="Edit message"
                    size="2xs"
                    variant="ghost"
                    position="absolute"
                    top={1}
                    right={1}
                    opacity={0.6}
                    _hover={{ opacity: 1 }}
                    onClick={() => {
                      setEditText(message.content || '');
                      setIsEditing(true);
                    }}
                  >
                    <LuPencil />
                  </IconButton>
                )}
              </Box>
            )}
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
              aria-label={showThinking ? "Hide Thinking" : "Show Thinking"}
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
        content: message.content,
        ...(message.details && { details: message.details as import('@/lib/types').ToolCallDetails })
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
});

export default SimpleChatMessage;
