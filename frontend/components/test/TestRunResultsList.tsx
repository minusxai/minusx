'use client';

import { Box, Text, VStack, HStack } from '@chakra-ui/react';
import type { TestRunResult } from '@/lib/types';
import TestResultBadge from './TestResultBadge';

function deriveLabel(result: TestRunResult, index: number): string {
  if (result.test.label) return result.test.label;
  if (result.test.type === 'llm' && result.test.subject.type === 'llm') {
    const p = result.test.subject.prompt;
    return p.length > 60 ? p.slice(0, 60) + '…' : p;
  }
  return `Test ${index + 1}`;
}

interface TestRunResultsListProps {
  results: TestRunResult[];
  /**
   * 'default'  — standalone bordered box with summary header (evals/context)
   * 'compact'  — no outer border; attaches inside a parent card via borderTop (transforms)
   * 'colored'  — rows highlighted red/green per pass/fail (alerts)
   */
  variant?: 'default' | 'compact' | 'colored';
  emptyText?: string;
}

export default function TestRunResultsList({
  results,
  variant = 'default',
  emptyText = 'No tests were run.',
}: TestRunResultsListProps) {
  if (results.length === 0) {
    if (variant === 'compact') return null;
    return <Text fontSize="sm" color="fg.muted">{emptyText}</Text>;
  }

  const passed = results.filter(r => r.passed).length;
  const total = results.length;

  if (variant === 'compact') {
    return (
      <Box px={3} py={2} bg="bg.surface" borderTopWidth="1px" borderColor="border.muted">
        <Text fontSize="xs" color="fg.muted" fontWeight="600" mb={1}>
          Tests: {passed}/{total} passed
        </Text>
        <VStack align="stretch" gap={1}>
          {results.map((r, i) => (
            <HStack key={i} gap={2}>
              <TestResultBadge result={r} showDetails />
              {r.test.label && (
                <Text fontSize="xs" color="fg.muted" truncate>{r.test.label}</Text>
              )}
            </HStack>
          ))}
        </VStack>
      </Box>
    );
  }

  if (variant === 'colored') {
    return (
      <VStack align="stretch" gap={2}>
        {results.map((r, i) => (
          <HStack key={i} gap={2} p={2} borderRadius="md" bg={r.passed ? 'green.subtle' : 'red.subtle'}>
            <TestResultBadge result={r} showDetails />
            <Text fontSize="xs" color="fg.muted" truncate flex={1}>{deriveLabel(r, i)}</Text>
          </HStack>
        ))}
      </VStack>
    );
  }

  // default variant
  return (
    <Box>
      <Text fontSize="xs" color="fg.muted" fontWeight="600" mb={2}>
        {passed}/{total} passed
      </Text>
      <Box borderRadius="md" border="1px solid" borderColor="border.muted" overflow="hidden">
        {results.map((r, i) => (
          <HStack
            key={i}
            gap={2}
            px={3}
            py={2}
            borderBottomWidth="1px"
            borderColor="border.muted"
            _last={{ borderBottom: 'none' }}
          >
            <TestResultBadge result={r} showDetails />
            <Text fontSize="xs" color="fg.muted" truncate flex={1}>{deriveLabel(r, i)}</Text>
          </HStack>
        ))}
      </Box>
    </Box>
  );
}
