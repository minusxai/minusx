'use client';

import { useState } from 'react';
import { Box, HStack, Button, Icon } from '@chakra-ui/react';
import { LuCopy, LuCheck } from 'react-icons/lu';

interface JsonViewerProps {
  data: any;
  title?: string;
}

export default function JsonViewer({ data, title }: JsonViewerProps) {
  const [copied, setCopied] = useState(false);

  const jsonString = JSON.stringify(data, null, 2);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Box>
      {title && (
        <HStack justify="space-between" mb={2} px={3} py={2} bg="bg.muted" borderRadius="md">
          <Box fontWeight="600" fontSize="sm" fontFamily="mono">{title}</Box>
          <Button
            size="xs"
            onClick={handleCopy}
            variant="ghost"
            colorScheme={copied ? 'green' : 'gray'}
          >
            <Icon as={copied ? LuCheck : LuCopy} boxSize={3} mr={1} />
            {copied ? 'Copied!' : 'Copy'}
          </Button>
        </HStack>
      )}
      <Box
        as="pre"
        p={4}
        bg="bg.muted"
        color="accent.teal"
        borderRadius="md"
        overflow="auto"
        maxH="80vh"
        fontSize="xs"
        fontFamily="mono"
        whiteSpace="pre-wrap"
        wordBreak="break-word"
      >
        {jsonString}
      </Box>
    </Box>
  );
}
