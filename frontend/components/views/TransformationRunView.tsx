'use client';

import { Box, Text, VStack, HStack, Badge } from '@chakra-ui/react';
import { useState } from 'react';
import { LuChevronDown, LuChevronRight, LuClock, LuTimer, LuFlaskConical } from 'react-icons/lu';
import type { RunFileContent, TestRunResult, TransformationOutput, TransformResult } from '@/lib/types';
import TestResultBadge from '@/components/test/TestResultBadge';

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: 'success' | 'error' | 'running' | 'failure' | 'skipped' }) {
  const colorPalette =
    status === 'success' ? 'green' :
    status === 'error' || status === 'failure' ? 'red' :
    status === 'skipped' ? 'gray' :
    'yellow';
  const label = status.toUpperCase();
  return <Badge colorPalette={colorPalette} size="sm" fontWeight="700">{label}</Badge>;
}

function TestResultsList({ testResults }: { testResults: TestRunResult[] }) {
  if (!testResults.length) return null;
  const passed = testResults.filter(r => r.passed).length;
  return (
    <Box px={3} py={2} bg="bg.surface" borderTopWidth="1px" borderColor="border.muted">
      <Text fontSize="xs" color="fg.muted" fontWeight="600" mb={1}>
        Tests: {passed}/{testResults.length} passed
      </Text>
      <VStack align="stretch" gap={1}>
        {testResults.map((r, i) => (
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

function TransformResultCard({ result }: { result: TransformResult }) {
  const [sqlOpen, setSqlOpen] = useState(false);
  const hasTests = result.testResults && result.testResults.length > 0;
  const allTestsPassed = hasTests && result.testResults!.every(r => r.passed);
  const someTestsFailed = hasTests && !allTestsPassed;

  return (
    <Box borderRadius="md" border="1px solid" borderColor="border.muted" overflow="hidden">
      <HStack
        px={3}
        py={2}
        bg="bg.muted"
        cursor={result.sql ? 'pointer' : 'default'}
        onClick={() => result.sql && setSqlOpen(o => !o)}
        gap={2}
      >
        {result.sql ? (
          <Box color="fg.muted" flexShrink={0}>
            {sqlOpen ? <LuChevronDown size={14} /> : <LuChevronRight size={14} />}
          </Box>
        ) : (
          <Box w="14px" flexShrink={0} />
        )}
        <Text fontSize="xs" fontFamily="mono" fontWeight="600" flex={1} color="fg.default">
          {result.schema}.{result.view}
        </Text>
        <Text fontSize="xs" color="fg.muted" flexShrink={0}>{result.questionName}</Text>
        {hasTests && (
          <Box color={someTestsFailed ? 'red.fg' : 'green.fg'} flexShrink={0} title={`${result.testResults!.filter(r => r.passed).length}/${result.testResults!.length} tests passed`}>
            <LuFlaskConical size={12} />
          </Box>
        )}
        <StatusBadge status={result.status} />
      </HStack>

      {result.status === 'error' && result.error && (
        <Box px={3} py={2} bg="red.subtle" borderTopWidth="1px" borderColor="red.muted">
          <Text fontSize="xs" color="red.fg" fontFamily="mono">{result.error}</Text>
        </Box>
      )}

      {sqlOpen && result.sql && (
        <Box px={3} py={2} bg="bg.surface" borderTopWidth="1px" borderColor="border.muted" maxH="200px" overflow="auto">
          <Text fontSize="xs" fontFamily="mono" whiteSpace="pre-wrap" color="fg.muted">{result.sql}</Text>
        </Box>
      )}

      {hasTests && <TestResultsList testResults={result.testResults!} />}
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  TransformationRunView — presentational                              */
/* ------------------------------------------------------------------ */

export interface TransformationRunViewProps {
  run: RunFileContent;
  inline?: boolean;
}

export default function TransformationRunView({ run, inline }: TransformationRunViewProps) {
  const output = run.output as TransformationOutput | undefined;
  const results = output?.results ?? [];
  const runMode = output?.runMode;

  const successCount = results.filter(r => r.status === 'success').length;
  const errorCount = results.filter(r => r.status === 'error').length;
  const skippedCount = results.filter(r => r.status === 'skipped').length;

  const allTestResults = results.flatMap(r => r.testResults ?? []);
  const testPassCount = allTestResults.filter(r => r.passed).length;

  const startTime = run.startedAt ? new Date(run.startedAt).toLocaleString() : null;
  const endTime = run.completedAt ? new Date(run.completedAt).toLocaleString() : null;
  const durationMs = run.startedAt && run.completedAt
    ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
    : null;

  return (
    <Box p={inline ? 0 : 4}>
      <VStack align="stretch" gap={3}>
        <HStack gap={3} wrap="wrap">
          <StatusBadge status={run.status === 'success' ? 'success' : run.status === 'failure' ? 'failure' : 'running'} />
          {runMode === 'test_only' && (
            <Badge colorPalette="purple" size="sm" fontWeight="700">
              <HStack gap={1}><LuFlaskConical size={10} /><span>TEST ONLY</span></HStack>
            </Badge>
          )}
          {results.length > 0 && (
            <Text fontSize="xs" color="fg.muted">
              {runMode === 'test_only'
                ? `${skippedCount} skipped`
                : `${successCount} succeeded · ${errorCount} failed · ${results.length} total`}
              {allTestResults.length > 0 && ` · ${testPassCount}/${allTestResults.length} tests passed`}
            </Text>
          )}
        </HStack>

        {run.error && (
          <Box p={3} bg="red.subtle" borderRadius="md" borderWidth="1px" borderColor="red.muted">
            <Text fontSize="xs" color="red.fg" fontFamily="mono">{run.error}</Text>
          </Box>
        )}

        <HStack gap={4} wrap="wrap">
          {startTime && (
            <HStack gap={1} color="fg.muted">
              <LuClock size={12} />
              <Text fontSize="xs">Started {startTime}</Text>
            </HStack>
          )}
          {durationMs !== null && (
            <HStack gap={1} color="fg.muted">
              <LuTimer size={12} />
              <Text fontSize="xs">
                {durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`}
              </Text>
            </HStack>
          )}
          {endTime && (
            <HStack gap={1} color="fg.muted">
              <LuClock size={12} />
              <Text fontSize="xs">Completed {endTime}</Text>
            </HStack>
          )}
        </HStack>

        {results.length > 0 && (
          <VStack align="stretch" gap={2}>
            {results.map((result, i) => (
              <TransformResultCard key={i} result={result} />
            ))}
          </VStack>
        )}

        {results.length === 0 && run.status === 'success' && (
          <Text fontSize="sm" color="fg.muted">No transforms were configured.</Text>
        )}
      </VStack>
    </Box>
  );
}
