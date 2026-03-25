'use client';

import { Box, Text, VStack, HStack, Badge } from '@chakra-ui/react';
import { LuClock } from 'react-icons/lu';
import type { ContextOutput, RunFileContent } from '@/lib/types';
import TestRunResultsList from '@/components/test/TestRunResultsList';
import { useFile } from '@/lib/hooks/file-state-hooks';
import type { FileId } from '@/store/filesSlice';

interface ContextRunViewProps {
  fileId: FileId;
}

export default function ContextRunView({ fileId }: ContextRunViewProps) {
  const { fileState } = useFile(fileId) ?? {};
  const runFile = fileState?.content as RunFileContent | undefined;
  if (!runFile) return null;

  const output = runFile.output as ContextOutput | undefined;
  const results = output?.results ?? [];
  const passed = results.filter(r => r.passed).length;
  const total = results.length;

  const startedAt = runFile.startedAt ? new Date(runFile.startedAt) : null;
  const completedAt = runFile.completedAt ? new Date(runFile.completedAt) : null;
  const durationMs = startedAt && completedAt ? completedAt.getTime() - startedAt.getTime() : null;

  return (
    <VStack align="stretch" gap={4}>
      <HStack gap={3} flexWrap="wrap">
        {runFile.status === 'success' ? (
          <Badge colorPalette={passed === total ? 'green' : 'red'} size="sm" fontWeight="700">
            {passed}/{total} passed
          </Badge>
        ) : runFile.status === 'failure' ? (
          <Badge colorPalette="red" size="sm" fontWeight="700">FAILED</Badge>
        ) : (
          <Badge colorPalette="yellow" size="sm" fontWeight="700">RUNNING</Badge>
        )}

        {startedAt && (
          <HStack gap={1} color="fg.muted">
            <LuClock size={12} />
            <Text fontSize="xs">{startedAt.toLocaleString()}</Text>
          </HStack>
        )}

        {durationMs !== null && (
          <Text fontSize="xs" color="fg.muted">
            {durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`}
          </Text>
        )}
      </HStack>

      {runFile.error && (
        <Box p={3} bg="red.subtle" borderRadius="md">
          <Text fontSize="xs" color="red.fg" fontFamily="mono">{runFile.error}</Text>
        </Box>
      )}

      <TestRunResultsList results={results} />
    </VStack>
  );
}
