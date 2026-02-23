'use client';

import React from 'react';
import { Box, Grid, GridItem } from '@chakra-ui/react';
import { ChatMessage as ChatMessageType, MessageDebugInfo } from '@/lib/types';
import ToolCallDisplay from './ToolCallDisplay';
import DebugInfoDisplay from './DebugInfoDisplay';
import Markdown from '../Markdown';
import { MessageWithMentions } from '../chat/MessageWithMentions';
import { useAppSelector } from '@/store/hooks';
import { cloneDeep, isEmpty } from 'lodash';
import { parseThinkingAnswer } from '@/lib/utils/xml-parser';


interface ChatMessageProps {
  message: ChatMessageType;
  databaseName?: string;
  isCompact?: boolean;
  showThinking?: boolean; // Show thinking blocks (exploratory context) or hide them (presentation context)
  markdownContext?: 'sidebar' | 'mainpage';
}

export default function ChatMessage({ message, databaseName, isCompact = false, showThinking = false, markdownContext = 'mainpage' }: ChatMessageProps) {
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
  const hasContent = !!message.content && message.content.trim().length > 0;
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  // Layout adjustments based on compact mode
  const userColSpan = isCompact ? 12 : { base: 12, md: 8 };
  const userColStart = isCompact ? 1 : { base: 1, md: 5};
//   const assistantColSpan = isCompact ? 12 : { base: 12, md: 8, lg: 6 };
//   const assistantColStart = isCompact ? 1 : { base: 1, md: 3, lg: 4 };
  const assistantColSpan = 12
  const assistantColStart = 1

  return (
    <Grid
      templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }}
      gap={2}
      w="100%"
    >
      {/* Message Content */}
      {hasContent && (
        <GridItem
          colSpan={isUser ? userColSpan : assistantColSpan}
          colStart={isUser ? userColStart : assistantColStart}
        >
          <Box
            p={3}
            bg={isUser ? (colorMode === 'dark' ? 'accent.teal/50' : 'accent.muted/20') : ''}
            borderRadius={isUser ? 'md' : ''}
            minW={isUser ? '100px' : ''}
          >
            {isUser ? (
              <MessageWithMentions
                content={message.content || ''}
                context={markdownContext}
                textAlign="left"
              />
            ) : (
              <Markdown context={markdownContext} textAlign='left'>
                {message.content || ''}
              </Markdown>
            )}
          </Box>
        </GridItem>
      )}

      {/* Tool Calls - Process rounds in order, interleaving TalkToUser/AnalystAgent and other tools */}
      {!isUser && message.completed_tool_calls && (
        <>
          {message.completed_tool_calls.map((round, roundIndex) => {
            // Separate TalkToUser and AnalystAgent from other tools in this round
            const talkToUserTools: typeof round = [];
            const regularTools: typeof round = [];

            round.forEach((toolCallTuple) => {
              const [toolCall] = toolCallTuple;

              if (toolCall.function.name === 'TalkToUser') {
                talkToUserTools.push(toolCallTuple);
              } else if (toolCall.function.name === 'AnalystAgent') {
                const toolCall = toolCallTuple[0]
                const toolCallResponse = cloneDeep(toolCallTuple[1])

                // AnalystAgent content can be a string (JSON) or object
                let extractedContent;
                if (typeof toolCallResponse.content === 'string') {
                  try {
                    const parsed = JSON.parse(toolCallResponse.content);
                    extractedContent = parsed.content;
                  } catch (e) {
                    console.warn('[ChatMessage] Failed to parse AnalystAgent JSON:', e);
                    extractedContent = toolCallResponse.content;
                  }
                } else if (typeof toolCallResponse.content === 'object') {
                  extractedContent = toolCallResponse.content?.content;
                }

                toolCallResponse.content = extractedContent;
                if (!isEmpty(toolCallResponse.content)) {
                  talkToUserTools.push([toolCall, toolCallResponse]);
                }
              } else {
                regularTools.push(toolCallTuple);
              }
            });

            return (
              <React.Fragment key={`round-${roundIndex}`}>
                {/* Render TalkToUser and AnalystAgent tools first (full 12 cols on mobile, 8 cols on desktop) */}
                {talkToUserTools.map((toolCallTuple) => {
                  const [toolCall, toolMessage] = toolCallTuple;
                  const content = typeof toolMessage.content === 'string'
                    ? toolMessage.content
                    : JSON.stringify(toolMessage.content);

                  // Try to parse thinking/answer tags
                  const parsed = parseThinkingAnswer(content, false);

                  // If no tags found, render as before (backwards compatibility)
                  if (!parsed) {
                    return (
                      <GridItem
                        key={toolCall.id}
                        colSpan={assistantColSpan}
                        colStart={assistantColStart}
                      >
                        <Box px={3} py={1}>
                          <Markdown context={markdownContext}>{content}</Markdown>
                        </Box>
                      </GridItem>
                    );
                  }

                  // Render thinking blocks only in exploratory context (showThinking=true)
                  // In presentation context (showThinking=false), only show answer blocks
                  return (
                    <React.Fragment key={toolCall.id}>
                      {/* Thinking blocks - only in exploratory section */}
                      {showThinking && parsed.thinking.map((block, idx) => (
                        <GridItem
                          key={`thinking-${idx}`}
                          colSpan={assistantColSpan}
                          colStart={assistantColStart}
                        >
                          <Box px={3} py={1}>
                            <Markdown context={markdownContext}>{block}</Markdown>
                          </Box>
                        </GridItem>
                      ))}

                      {/* Unparsed content (content before first tag) */}
                      {parsed.unparsed && (
                        <GridItem
                          colSpan={assistantColSpan}
                          colStart={assistantColStart}
                        >
                          <Box px={3} py={1}>
                            <Markdown context={markdownContext}>{parsed.unparsed}</Markdown>
                          </Box>
                        </GridItem>
                      )}

                      {/* Answer blocks - user-facing responses */}
                      {parsed.answer.map((answerBlock, idx) => (
                        <GridItem
                          key={`answer-${idx}`}
                          colSpan={assistantColSpan}
                          colStart={assistantColStart}
                        >
                          <Box px={3} py={1}>
                            <Markdown context={markdownContext}>{answerBlock}</Markdown>
                          </Box>
                        </GridItem>
                      ))}
                    </React.Fragment>
                  );
                })}

                {/* Render regular tools (full 12 cols on mobile, 10 cols on desktop) */}
                {regularTools.map((toolCallTuple) => {
                      const [toolCall] = toolCallTuple;
                      return (
                        <ToolCallDisplay key={toolCall.id} toolCallTuple={toolCallTuple} databaseName={databaseName} isCompact={isCompact} showThinking={showThinking} markdownContext={markdownContext}/>
                      );
                    })}

              </React.Fragment>
            );
          })}
        </>
      )}
    </Grid>
  );
}
