'use client';

/**
 * The trash affordance on a context editor row — semantic models, data models,
 * and the nested field rows inside a model. Shared so "delete this row" looks and
 * behaves identically wherever it appears, and so a row's delete is never gated
 * on whether its detail panel happens to be open.
 */

import React from 'react';
import { Box, Icon } from '@chakra-ui/react';
import { LuTrash2 } from 'react-icons/lu';

export default function DeleteRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Box as="button" aria-label={label}
      onClick={(e: React.MouseEvent) => { e.stopPropagation(); onClick(); }}
      color="fg.subtle" cursor="pointer"
      _hover={{ color: 'accent.danger' }} flexShrink={0} lineHeight={1}>
      <Icon as={LuTrash2} boxSize={3.5} />
    </Box>
  );
}
