/**
 * SqlPreview - Read-only preview of generated SQL
 */

'use client';

import { Box, Text, Code, HStack } from '@chakra-ui/react';
import { LuCode } from 'react-icons/lu';

interface SqlPreviewProps {
  sql: string;
}

export function SqlPreview({ sql }: SqlPreviewProps) {
  return (
    <Box>
      <Text fontSize="sm" fontWeight="medium" mb={2}>
        <HStack gap={1}>
          <LuCode />
          <span>Generated SQL</span>
        </HStack>
      </Text>
      <Code
        display="block"
        p={3}
        borderRadius="md"
        bg="gray.50"
        _dark={{ bg: 'gray.800' }}
        fontSize="sm"
        whiteSpace="pre-wrap"
        fontFamily="mono"
      >
        {sql}
      </Code>
    </Box>
  );
}
