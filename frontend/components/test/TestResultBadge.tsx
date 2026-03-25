'use client';

import { Badge, HStack, Text, Box, Spinner } from '@chakra-ui/react';
import { LuCircleCheck, LuCircleX, LuInfo } from 'react-icons/lu';
import type { TestRunResult } from '@/lib/types';

interface TestResultBadgeProps {
  result: TestRunResult | null;
  running?: boolean;
  /** If true, show actual vs expected values inline */
  showDetails?: boolean;
}

export default function TestResultBadge({ result, running, showDetails }: TestResultBadgeProps) {
  if (running) {
    return (
      <HStack gap={1}>
        <Spinner size="xs" color="yellow.500" />
        <Text fontSize="xs" color="fg.muted">Running…</Text>
      </HStack>
    );
  }

  if (!result) return null;

  if (result.passed) {
    return (
      <HStack gap={1} wrap="wrap">
        <Badge colorPalette="green" size="sm" fontWeight="700">
          <HStack gap={1}>
            <LuCircleCheck size={12} />
            <span>PASS</span>
          </HStack>
        </Badge>
        {showDetails && result.actualValue !== undefined && (
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            {String(result.actualValue)}
          </Text>
        )}
      </HStack>
    );
  }

  return (
    <HStack gap={1} wrap="wrap">
      <Badge colorPalette="red" size="sm" fontWeight="700">
        <HStack gap={1}>
          <LuCircleX size={12} />
          <span>FAIL</span>
        </HStack>
      </Badge>
      {showDetails && (
        <Text fontSize="xs" color="red.fg" fontFamily="mono">
          {result.error
            ? result.error
            : `got ${result.actualValue ?? 'null'}, expected ${result.expectedValue ?? 'null'}`}
        </Text>
      )}
      {!showDetails && result.error && (
        <Box title={result.error} cursor="help" color="red.fg">
          <LuInfo size={12} />
        </Box>
      )}
    </HStack>
  );
}
