import React from 'react';
import { Box } from '@chakra-ui/react';
import Markdown from '../Markdown';

interface MentionData {
  id?: number;
  name: string;
  schema?: string;
  type: 'table' | 'question';
}

interface MessageWithMentionsProps {
  content: string;
  context?: 'sidebar' | 'mainpage';
  textAlign?: 'left' | 'right' | 'center';
}

export function MessageWithMentions({ content, context = 'sidebar', textAlign = 'left' }: MessageWithMentionsProps) {
  // Parse message content to extract mentions and text parts
  const parts = parseMessageContent(content);

  // If no mentions found, render as plain Markdown
  const hasMentions = parts.some(p => p.type === 'mention');
  if (!hasMentions) {
    return (
      <Markdown context={context} textAlign={textAlign}>
        {content}
      </Markdown>
    );
  }

  // Handle copy event to include JSON representation
  const handleCopy = (e: React.ClipboardEvent) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    // Get the selected text
    let copiedText = '';
    const range = selection.getRangeAt(0);
    const container = range.cloneContents();

    // Helper to process a node and its children
    const processNode = (node: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        copiedText += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as HTMLElement;
        // Check if this element has our data-mention-json attribute
        const mentionJson = element.getAttribute('data-mention-json');
        if (mentionJson) {
          // Add the JSON and skip children (don't add display text)
          copiedText += mentionJson;
          return; // Don't process children
        }

        // Process children for non-mention elements
        node.childNodes.forEach(child => processNode(child));
      }
    };

    // Start processing from the container
    container.childNodes.forEach(child => processNode(child));

    if (copiedText) {
      e.preventDefault();
      e.clipboardData.setData('text/plain', copiedText);
    }
  };

  return (
    <Box as="span" display="inline" onCopy={handleCopy}>
      {parts.map((part, index) => {
        if (part.type === 'text') {
          // Render text inline without Markdown to avoid block spacing
          return (
            <Box key={index} as="span" whiteSpace="pre-wrap">
              {part.content}
            </Box>
          );
        } else {
          // Render mention chip
          const data = part.data!;
          const displayText = data.type === 'table'
            ? `${data.schema}.${data.name}`
            : data.name;

          return (
            <Box
              key={index}
              as="span"
              display="inline-flex"
              alignItems="center"
              px={1.5}
              py={0.5}
              mx={0.5}
              bg={data.type === 'table' ? 'blue.500/20' : 'purple.500/20'}
              color={data.type === 'table' ? 'blue.400' : 'purple.400'}
              borderRadius="sm"
              fontSize="sm"
              fontWeight="600"
              border="1px solid"
              borderColor={data.type === 'table' ? 'blue.500/30' : 'purple.500/30'}
              verticalAlign="middle"
              data-mention-json={part.content}
              userSelect="all"
            >
              <Box
                as="span"
                px={1}
                py={0.5}
                bg={data.type === 'table' ? 'blue.500' : 'purple.500'}
                color="white"
                borderRadius="sm"
                fontSize="2xs"
                fontWeight="700"
                mr={1}
              >
                {data.type === 'table' ? 'TABLE' : 'Q'}
              </Box>
              {displayText}
            </Box>
          );
        }
      })}
    </Box>
  );
}

interface ParsedPart {
  type: 'text' | 'mention';
  content: string;
  data?: MentionData;
}

function parseMessageContent(content: string): ParsedPart[] {
  const parts: ParsedPart[] = [];

  // Regex to match @{...json...} - use lazy matching to get full JSON object
  const mentionRegex = /@(\{.+?\})/g;

  let lastIndex = 0;
  let match;

  while ((match = mentionRegex.exec(content)) !== null) {
    // Add text before the mention
    if (match.index > lastIndex) {
      parts.push({
        type: 'text',
        content: content.slice(lastIndex, match.index),
      });
    }

    // Parse and add the mention
    try {
      const mentionData = JSON.parse(match[1]) as MentionData;
      parts.push({
        type: 'mention',
        content: match[0],
        data: mentionData,
      });
    } catch (e) {
      // If JSON parse fails, treat as text
      parts.push({
        type: 'text',
        content: match[0],
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last mention
  if (lastIndex < content.length) {
    parts.push({
      type: 'text',
      content: content.slice(lastIndex),
    });
  }

  // If no mentions found, return the whole content as text
  if (parts.length === 0) {
    parts.push({
      type: 'text',
      content,
    });
  }

  return parts;
}
