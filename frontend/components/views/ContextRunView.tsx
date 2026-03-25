'use client';

import { Box, Text, VStack, HStack, Badge } from '@chakra-ui/react';
import { LuClock } from 'react-icons/lu';
import type { ContextOutput, RunFileContent, TestRunResult } from '@/lib/types';
import TestResultBadge from '@/components/test/TestResultBadge';

function TestResultRow({ result }: { result: TestRunResult }) {
  const label = result.test.label
    ?? (result.test.type === 'llm' && result.test.subject.type === 'llm'
        ? result.test.subject.prompt.slice(0, 60) + (result.test.subject.prompt.length > 60 ? '…' : '')
        : `Test`);
  return (
    <HStack gap={2} px={3} py={2} borderBottomWidth="1px" borderColor="border.muted" _last={{ borderBottom: 'none' }}>
      <TestResultBadge result={result} showDetails />
      <Text fontSize="xs" color="fg.muted" truncate flex={1}>{label}</Text>
    </HStack>
  );
}

interface ContextRunViewProps {
  runFile: RunFileContent;
}

export default function ContextRunView({ runFile }: ContextRunViewProps) {
  const output = runFile.output as ContextOutput | undefined;
  const results: TestRunResult[] = output?.results ?? [];
  const passed = results.filter(r => r.passed).length;
  const total = results.length;

  const startedAt = runFile.startedAt ? new Date(runFile.startedAt) : null;
  const completedAt = runFile.completedAt ? new Date(runFile.completedAt) : null;
  const durationMs = startedAt && completedAt ? completedAt.getTime() - startedAt.getTime() : null;

  return (
    <VStack align="stretch" gap={4}>
      {/* Run summary */}
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

      {/* Test results */}
      {results.length > 0 && (
        <Box borderRadius="md" border="1px solid" borderColor="border.muted" overflow="hidden">
          {results.map((r, i) => (
            <TestResultRow key={i} result={r} />
          ))}
        </Box>
      )}

      {results.length === 0 && runFile.status !== 'running' && (
        <Text fontSize="sm" color="fg.muted">No tests were run.</Text>
      )}
    </VStack>
  );
}
