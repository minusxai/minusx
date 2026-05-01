import React from 'react';
import { Box, Icon, Text } from '@chakra-ui/react';
import Markdown from '../Markdown';
import type { ChatMentionData } from '@/lib/types';
import { ACCENT_HEX } from '@/lib/ui/file-metadata';
import { getMentionChipMetadata } from './lexical/MentionNode';

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
    <Box as="span" display="inline" fontFamily="mono" onCopy={handleCopy}>
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
          const displayText = data.name;
          const metaText = data.type === 'table' ? data.schema : undefined;
          const isSkill = data.type === 'skill';

          const colorMap: Record<string, string> = {
            'accent.primary': ACCENT_HEX.primary,
            'accent.danger': ACCENT_HEX.danger,
            'accent.secondary': ACCENT_HEX.secondary,
            'accent.success': ACCENT_HEX.success,
            'accent.warning': ACCENT_HEX.warning,
            'accent.teal': ACCENT_HEX.teal,
            'accent.info': ACCENT_HEX.info,
            'accent.cyan': ACCENT_HEX.cyan,
            'accent.muted': ACCENT_HEX.muted,
          };
          const metadata = getMentionChipMetadata(data, colorMap);

          // Map mention type to Chakra semantic color token for the icon
          const iconColorToken = isSkill ? 'accent.teal'
            : data.type === 'table' ? 'accent.cyan'
            : data.type === 'question' ? 'accent.primary'
            : data.type === 'dashboard' ? 'accent.danger'
            : 'fg.muted';

          return (
            <Box
              key={index}
              as="span"
              display="inline"
              px="4px"
              py="2px"
              mx="1px"
              bg="bg.muted"
              borderRadius="sm"
              fontSize="0.85em"
              fontFamily="mono"
              lineHeight="inherit"
              color="fg.default"
              fontWeight="600"
              whiteSpace="nowrap"
              data-mention-json={part.content}
              userSelect="all"
            >
              <Text as="span" color={iconColorToken}>
                {isSkill ? '/' : metadata.icon ? <Icon as={metadata.icon} boxSize="0.85em" verticalAlign="-0.1em" /> : null}
              </Text>
              {' '}
              {metaText && (
                <Text as="span" color="fg.muted" fontWeight="500">{metaText}.</Text>
              )}
              <Text as="span">{displayText}</Text>
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
  data?: ChatMentionData;
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
      const mentionData = JSON.parse(match[1]) as ChatMentionData;
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
