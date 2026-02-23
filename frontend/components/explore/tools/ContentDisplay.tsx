'use client';

import { Box, GridItem, Text, Badge, Link, Flex } from '@chakra-ui/react';
import { Tooltip } from '@/components/ui/tooltip';
import { DisplayProps } from '@/lib/types';
import Markdown from '../../Markdown';
import { parseThinkingAnswer } from '@/lib/utils/xml-parser';



export default function ContentDisplay({ toolCallTuple, databaseName, isCompact, showThinking, markdownContext = 'mainpage' }: DisplayProps) {
  const [toolCall, toolMessage] = toolCallTuple;
  let content;
  let citations: any[] = [];

  try {
    const jsonParsed = typeof toolMessage.content === 'string'
      ? JSON.parse(toolMessage.content)
      : toolMessage.content;

    // NEW: Handle content_blocks array format (from LiteLLM streaming)
    if (jsonParsed?.content_blocks && Array.isArray(jsonParsed.content_blocks)) {
      // Extract text content from text blocks
      const textBlocks: string[] = [];

      for (const block of jsonParsed.content_blocks) {
        if (block.type === 'text' && block.text) {
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

  const parsed = parseThinkingAnswer(content);

  // Determine if we should show citations with thinking or answer
  const hasAnswer = parsed?.answer && parsed.answer.length > 0 && parsed.answer.some(a => a.trim().length > 0);
  const hasThinking = parsed?.thinking && parsed.thinking.length > 0;
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

  // Fallback: if no <thinking>/<answer> tags were found, render raw content directly
  if (!parsed && content) {
    return (
            <>
            <GridItem
                colSpan={12}
                colStart={1}
                my={2}
            >
                <Box px={3} py={1}>
                    <Markdown context={markdownContext}>{content}</Markdown>
                </Box>
            </GridItem>
            {citations.length > 0 && renderCitations(false)}
            </>
    );
  }

  return (
            <>
            {showThinking && parsed?.thinking.map((block, idx) => (
                <GridItem
                    key={`thinking-${idx}`}
                    colSpan={12}
                    colStart={1}
                    bg={"bg.elevated"}
                    borderRadius={"md"}
                    p={2}
                    my={1}
                >
                    <Box px={3} py={1}>
                        <Markdown context={markdownContext}>{block}</Markdown>
                    </Box>
                </GridItem>
            ))}

            {/* Show citations with thinking if no answer exists */}
            {showCitationsWithThinking && renderCitations(true)}

            {showThinking && parsed?.unparsed && (
                <GridItem
                    key={`unparsed`}
                    colSpan={12}
                    colStart={1}
                >
                    <Box px={3} py={1}>
                        <Markdown context={markdownContext}>{parsed?.unparsed}</Markdown>
                    </Box>
                </GridItem>
            )}

            {parsed?.answer.map((block, idx) => (
                <GridItem
                    key={`answer-${idx}`}
                    colSpan={12}
                    colStart={1}
                    my={2}
                >
                    <Box px={3} py={1}>
                        <Markdown context={markdownContext}>{block}</Markdown>
                    </Box>
                </GridItem>
            ))}

            {/* Show citations with answer if answer exists */}
            {showCitationsWithAnswer && renderCitations(false)}
            </>
  );
}
