'use client';

/**
 * SqlPeekDrawer — the collapsible read-only SQL peek at the bottom of the
 * semantic explorer. Always in sync with the compiled spec (the parent passes
 * content.query). Deliberately a plain <pre>, not Monaco — the peek is for
 * trust ("what will run?"), not editing; "Edit SQL" jumps to the full SQL tab.
 */

import React, { useState } from 'react';
import { Box, HStack, Text, Button } from '@chakra-ui/react';
import { LuChevronRight, LuChevronDown, LuCode, LuCopy } from 'react-icons/lu';

interface SqlPeekDrawerProps {
  sql: string;
  onEditSql?: () => void;
}

export function SqlPeekDrawer({ sql, onEditSql }: SqlPeekDrawerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Box borderTop="1px solid" borderColor="border.muted" pt={2} flexShrink={0}>
      <HStack justify="space-between" align="center">
        <HStack
          as="button"
          aria-label="Toggle SQL peek"
          gap={1.5}
          color="fg.muted"
          _hover={{ color: 'fg.default' }}
          onClick={() => setOpen((o) => !o)}
          flex={1}
          minW={0}
        >
          {open ? <LuChevronDown size={12} /> : <LuChevronRight size={12} />}
          <LuCode size={12} />
          <Text fontSize="2xs" fontFamily="mono" fontWeight="600" textTransform="uppercase" letterSpacing="0.05em">
            SQL
          </Text>
          {!open && (
            <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" truncate flex={1} textAlign="left">
              {sql.replace(/\s+/g, ' ').slice(0, 80)}
            </Text>
          )}
        </HStack>
        {open && (
          <HStack gap={1}>
            <Button
              aria-label="Copy SQL"
              size="2xs"
              variant="ghost"
              onClick={() => { void navigator.clipboard?.writeText(sql); }}
            >
              <LuCopy size={11} />
            </Button>
            {onEditSql && (
              <Button aria-label="Edit SQL" size="2xs" variant="outline" fontFamily="mono" onClick={onEditSql}>
                Edit SQL
              </Button>
            )}
          </HStack>
        )}
      </HStack>
      {open && (
        <Box
          as="pre"
          aria-label="Compiled SQL"
          mt={2}
          p={2}
          maxH="180px"
          overflowY="auto"
          bg="bg.muted"
          borderRadius="md"
          fontSize="2xs"
          fontFamily="mono"
          whiteSpace="pre-wrap"
          color="fg.muted"
        >
          {sql}
        </Box>
      )}
    </Box>
  );
}
