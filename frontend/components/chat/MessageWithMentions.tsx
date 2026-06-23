import React from 'react';
import { Box } from '@chakra-ui/react';
import Markdown from '../Markdown';
import { splitMentions } from '@/lib/utils/mentions';
import { MentionChip } from './MentionChip';

interface MessageWithMentionsProps {
  content: string;
  context?: 'sidebar' | 'mainpage';
  textAlign?: 'left' | 'right' | 'center';
}

export function MessageWithMentions({ content, context = 'sidebar', textAlign = 'left' }: MessageWithMentionsProps) {
  // Parse message content to extract mentions and text parts
  const parts = splitMentions(content);

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
              {part.value}
            </Box>
          );
        }
        // Render mention chip
        return <MentionChip key={index} data={part.data} raw={part.raw} />;
      })}
    </Box>
  );
}
