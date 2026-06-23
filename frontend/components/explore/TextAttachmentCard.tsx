'use client';

/**
 * TextAttachmentCard — renders a text attachment as a compact, expandable chip in
 * the chat transcript (mirrors how image attachments render inline). Used for the
 * "Interact with {agentName}" selection snippets, and any other text attachment.
 */

import { useState } from 'react';
import { Box, HStack, Icon, Text } from '@chakra-ui/react';
import { LuCode, LuFileText, LuChevronRight } from 'react-icons/lu';
import type { Attachment } from '@/lib/types';

export default function TextAttachmentCard({ attachment }: { attachment: Attachment }) {
  const [open, setOpen] = useState(false);

  const isCode = attachment.metadata?.language === 'sql';
  const lineCount = attachment.content ? attachment.content.split('\n').length : 0;
  const lineText = `${lineCount} selected ${lineCount === 1 ? 'line' : 'lines'}`;

  return (
    <Box mt={2} maxW="100%">
      <HStack
        as="button"
        aria-label={`Selected snippet, ${lineText}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        gap={1.5}
        px={2}
        py={1}
        maxW="100%"
        bg="bg.muted"
        border="1px solid"
        borderColor="border.muted"
        borderRadius="md"
        cursor="pointer"
        transition="background 0.12s, border-color 0.12s"
        _hover={{ bg: 'bg.emphasized', borderColor: 'border.emphasized' }}
      >
        <Icon as={isCode ? LuCode : LuFileText} boxSize={3.5} color="accent.cyan" flexShrink={0} />
        <Text as="span" fontSize="xs" fontFamily="mono" color="fg.muted" truncate>
          <Box as="span" color="fg.default" fontWeight="600">{lineCount}</Box>
          {' '}selected {lineCount === 1 ? 'line' : 'lines'}
        </Text>
        <Icon
          as={LuChevronRight}
          boxSize={3.5}
          color="fg.subtle"
          flexShrink={0}
          transition="transform 0.15s ease"
          transform={open ? 'rotate(90deg)' : 'rotate(0deg)'}
        />
      </HStack>

      {open && (
        <Box
          aria-label="Snippet content"
          mt={1}
          p={2}
          bg="bg.subtle"
          border="1px solid"
          borderColor="border.muted"
          borderRadius="md"
          maxH="240px"
          overflow="auto"
          fontFamily="mono"
          fontSize="xs"
          color="fg.default"
          whiteSpace="pre"
        >
          {attachment.content}
        </Box>
      )}
    </Box>
  );
}
