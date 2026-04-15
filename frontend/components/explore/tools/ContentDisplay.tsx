'use client';

import { Box, GridItem, Text, Badge, Link, Flex, HStack } from '@chakra-ui/react';
import { LuChevronRight, LuChevronDown } from 'react-icons/lu';
import { Tooltip } from '@/components/ui/tooltip';
import { DisplayProps } from '@/lib/types';
import Markdown from '../../Markdown';
import { parseThinkingAnswer } from '@/lib/utils/xml-parser';



export default function ContentDisplay({ toolCallTuple, databaseName, isCompact, showThinking, toggleShowThinking, markdownContext = 'mainpage' }: DisplayProps) {
  const [toolCall, toolMessage] = toolCallTuple;
  let content;
  let citations: any[] = [];
  let nativeThinkingBlocks: string[] = [];

  try {
    const jsonParsed = typeof toolMessage.content === 'string'
      ? JSON.parse(toolMessage.content)
      : toolMessage.content;

    // Handle content_blocks array format (from LiteLLM streaming)
    if (jsonParsed?.content_blocks && Array.isArray(jsonParsed.content_blocks)) {
      const textBlocks: string[] = [];

      for (const block of jsonParsed.content_blocks) {
        if (block.type === 'thinking' && block.thinking) {
          // Native adaptive thinking block
          nativeThinkingBlocks.push(block.thinking);
        } else if (block.type === 'text' && block.text) {
          textBlocks.push(block.text);

          // Extract citations from this text block (if embedded)
          if (block.citations && Array.isArray(block.citations)) {
            citations.push(...block.citations);
          }
        }
        // Extract citations from web_search_tool_result blocks
        else if (block.type === 'web_search_tool_result' && block.content && Array.isArray(block.content)) {
          for (const searchItem of block.content) {
            if (searchItem.type === 'web_search_result') {
              citations.push({
                type: 'web_search_result_location',
                url: searchItem.url,
                title: searchItem.title,
                cited_text: searchItem.title // Use title as cited text
              });
            }
          }
        }
      }

      content = textBlocks.join('\n\n');
    }
    // LEGACY: Handle old format with content/answer fields
    else if (jsonParsed?.content) {
      content = typeof jsonParsed.content === 'string' ? jsonParsed.content : JSON.stringify(jsonParsed.content);
      citations = jsonParsed?.citations || [];
    } else if (jsonParsed?.answer) {
      content = typeof jsonParsed.answer === 'string' ? jsonParsed.answer : JSON.stringify(jsonParsed.answer);
      citations = jsonParsed?.citations || [];
    }
  } catch (error) {
    // If JSON parse fails, just use the original
    content = typeof toolMessage.content === 'string'
      ? toolMessage.content
      : JSON.stringify(toolMessage.content);
    citations = [];
  }

  // Backward compat: old messages used <thinking>/<answer> XML tags in the text content
  const legacyParsed = nativeThinkingBlocks.length === 0 ? parseThinkingAnswer(content) : null;

  const hasNativeThinking = nativeThinkingBlocks.length > 0;
  const hasLegacyThinking = !!legacyParsed?.thinking?.length;
  const hasThinking = hasNativeThinking || hasLegacyThinking;

  // For legacy messages, use the parsed answer blocks; for new messages use content directly
  const hasAnswer = legacyParsed
    ? legacyParsed.answer.length > 0 && legacyParsed.answer.some(a => a.trim().length > 0)
    : !!content;

  const showCitationsWithThinking = !hasAnswer && hasThinking && showThinking;
  const showCitationsWithAnswer = hasAnswer;

  // Citations component factory (different styling for thinking vs answer)
  const renderCitations = (isInThinkingBlock: boolean) => {
    if (!citations || citations.length === 0) return null;

    return (
      <GridItem
        colSpan={12}
        colStart={1}
        my={2}
        bg={isInThinkingBlock ? "bg.elevated" : undefined}
        borderRadius={isInThinkingBlock ? "md" : undefined}
        p={isInThinkingBlock ? 2 : 0}
      >
        <Box px={3} py={1}>
          <Flex gap={1} flexWrap="wrap" alignItems="center">
            <Text
              fontSize="xs"
              color="fg.subtle"
              fontWeight="semibold"
              textTransform="uppercase"
              letterSpacing="wider"
            >
              Sources:
            </Text>
            {citations.map((citation: any, idx: number) => {
              const urlObj = new URL(citation.url);
              const domain = urlObj.hostname.replace('www.', '');

              return (
                <Tooltip
                  key={idx}
                  content={
                    <Box maxW="600px" p={2}>
                      <Text fontWeight="bold" mb={2} fontSize="sm">{citation.title}</Text>
                      <Text fontSize="xs" color="fg.muted" mb={2}>{citation.url}</Text>
                      {citation.cited_text && <Text fontSize="xs">"...{citation.cited_text}"</Text>}
                    </Box>
                  }
                  contentProps={{
                    bg: "bg.panel",
                    color: "fg",
                    px: 3,
                    py: 2,
                    borderRadius: "md",
                    boxShadow: "lg"
                  }}
                >
                  <Link
                    href={citation.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    _hover={{ textDecoration: 'none' }}
                  >
                    <Badge
                      cursor="pointer"
                      bg={"accent.teal/40"}
                      px={2}
                      py={1}
                      borderRadius="full"
                      fontSize="xs"
                      fontWeight="medium"
                      display="flex"
                      alignItems="center"
                      gap={1}
                      _hover={{ bg: 'accent.teal' }}
                      transition="all 0.2s"
                    >
                      <Text as="span">{domain}</Text>
                    </Badge>
                  </Link>
                </Tooltip>
              );
            })}
          </Flex>
        </Box>
      </GridItem>
    );
  };

  // Determine what thinking blocks to show
  const thinkingToRender = hasNativeThinking ? nativeThinkingBlocks : (legacyParsed?.thinking ?? []);

  // Determine what answer content to render
  const answerBlocks = legacyParsed ? legacyParsed.answer : (content ? [content] : []);

  return (
            <>
            {/* Show/Hide Thinking toggle — only when thinking exists */}
            {hasThinking && toggleShowThinking && (
              <GridItem colSpan={12} colStart={1}>
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
            )}

            {/* Native or legacy thinking blocks */}
            {showThinking && thinkingToRender.map((block, idx) => (
                <GridItem
                    key={`thinking-${idx}`}
                    colSpan={12}
                    colStart={1}
                    bg={"bg.elevated"}
                    borderRadius={"md"}
                    p={2}
                    my={1}
                >
                    <Box px={3} py={1} aria-label="Thinking block">
                        <Markdown context={markdownContext}>{block}</Markdown>
                    </Box>
                </GridItem>
            ))}

            {/* Show citations with thinking if no answer exists */}
            {showCitationsWithThinking && renderCitations(true)}

            {/* Legacy unparsed content (content before first XML tag) */}
            {legacyParsed?.unparsed && (
                <GridItem
                    key={`unparsed`}
                    colSpan={12}
                    colStart={1}
                >
                    <Box px={3} py={1}>
                        <Markdown context={markdownContext}>{legacyParsed.unparsed}</Markdown>
                    </Box>
                </GridItem>
            )}

            {answerBlocks.map((block, idx) => (
                <GridItem
                    key={`answer-${idx}`}
                    colSpan={12}
                    colStart={1}
                    my={2}
                >
                    <Box px={3} py={1} aria-label="Answer block">
                        <Markdown context={markdownContext}>{block}</Markdown>
                    </Box>
                </GridItem>
            ))}

            {/* Show citations with answer if answer exists */}
            {showCitationsWithAnswer && renderCitations(false)}
            </>
  );
}
