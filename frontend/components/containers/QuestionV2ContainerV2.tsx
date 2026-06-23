'use client';

import React from 'react';
import { Box } from '@chakra-ui/react';
import SmartEmbeddedQuestionContainer from './SmartEmbeddedQuestionContainer';
import type { FileComponentProps } from '@/lib/ui/fileComponents';

/**
 * Minimal standalone view for a QuestionV2 file (File Architecture v2). The
 * query/connection/viz live in the file's `jsx` body; this renders the chart via
 * the same embed path stories use (which derives the effective QuestionContent from
 * `jsx`). The rich two-mode GUI editor is a later milestone — M1 is view-first.
 */
export default function QuestionV2ContainerV2({ fileId }: FileComponentProps) {
  return (
    <Box h="100%" w="100%" display="flex" flexDirection="column" p={4}>
      <SmartEmbeddedQuestionContainer questionId={fileId as number} showTitle />
    </Box>
  );
}
