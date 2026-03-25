'use client';

import { Box, Text, VStack, HStack } from '@chakra-ui/react';
import { useState } from 'react';
import type { TestRunResult } from '@/lib/types';
import type { CompletedToolCallFromPython } from '@/lib/chat-orchestration';
import TestResultBadge from './TestResultBadge';
import { LuChevronDown, LuChevronRight, LuWrench, LuCheck } from 'react-icons/lu';

function deriveLabel(result: TestRunResult, index: number): string {
  if (result.test.label) return result.test.label;
  if (result.test.type === 'llm' && result.test.subject.type === 'llm') {
    const p = result.test.subject.prompt;
    return p.length > 60 ? p.slice(0, 60) + '…' : p;
  }
  return `Test ${index + 1}`;
}

function ToolCallTrace({ log }: { log: unknown[] }) {
  const [expandedCalls, setExpandedCalls] = useState<Set<number>>(new Set());

  const toggleCall = (index: number) => {
    setExpandedCalls(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const toolCalls = log as CompletedToolCallFromPython[];

  return (
    <Box mt={2} pl={2} borderLeftWidth="2px" borderColor="border.muted">
      <Text fontSize="xs" fontWeight="600" color="fg.muted" mb={1} textTransform="uppercase" letterSpacing="wider">
        Trace
      </Text>
      <VStack align="stretch" gap={1}>
        {toolCalls.map((call, i) => {
          const isExpanded = expandedCalls.has(i);
          const fnName = call.function?.name ?? 'unknown';
          return (
            <Box key={i} bg="bg.muted" borderRadius="sm" overflow="hidden">
              <HStack
                px={2}
                py={1}
                cursor="pointer"
                onClick={() => toggleCall(i)}
                gap={1.5}
              >
                <Box color="fg.muted" flexShrink={0}>
                  {isExpanded ? <LuChevronDown size={12} /> : <LuChevronRight size={12} />}
                </Box>
                <Box color="accent.teal" flexShrink={0}>
                  <LuWrench size={12} />
                </Box>
                <Text fontSize="xs" fontFamily="mono" fontWeight="600" flex={1} truncate color="fg.default">
                  {fnName}
                </Text>
                <Box color="green.fg" flexShrink={0}>
                  <LuCheck size={12} />
                </Box>
              </HStack>
              {isExpanded && (
                <Box px={2} pb={2} borderTopWidth="1px" borderColor="border.muted">
                  {call.function?.arguments && Object.keys(call.function.arguments).length > 0 && (
                    <Box mb={1}>
                      <Text fontSize="xs" color="fg.muted" fontWeight="600" mb={0.5}>Args</Text>
                      <Box bg="bg.surface" borderRadius="sm" p={1} overflow="auto" maxH="120px">
                        <Text fontSize="xs" fontFamily="mono" whiteSpace="pre-wrap" color="fg.default">
                          {JSON.stringify(call.function.arguments, null, 2)}
                        </Text>
                      </Box>
                    </Box>
                  )}
                  {call.content !== undefined && call.content !== null && (
                    <Box>
                      <Text fontSize="xs" color="fg.muted" fontWeight="600" mb={0.5}>Result</Text>
                      <Box bg="bg.surface" borderRadius="sm" p={1} overflow="auto" maxH="120px">
                        <Text fontSize="xs" fontFamily="mono" whiteSpace="pre-wrap" color="fg.default">
                          {typeof call.content === 'string'
                            ? call.content
                            : JSON.stringify(call.content, null, 2)}
                        </Text>
                      </Box>
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          );
        })}
      </VStack>
    </Box>
  );
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
  /** If true, each row is expandable to show the tool call trace from result.log */
  showTrace?: boolean;
}

export default function TestRunResultsList({
  results,
  variant = 'default',
  emptyText = 'No tests were run.',
  showTrace = false,
}: TestRunResultsListProps) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const toggleRow = (index: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

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
            <Box key={i}>
              <HStack
                gap={2}
                cursor={showTrace && r.log && (r.log as unknown[]).length > 0 ? 'pointer' : undefined}
                onClick={showTrace && r.log && (r.log as unknown[]).length > 0 ? () => toggleRow(i) : undefined}
              >
                <TestResultBadge result={r} showDetails />
                {r.test.label && (
                  <Text fontSize="xs" color="fg.muted" truncate>{r.test.label}</Text>
                )}
                {showTrace && r.log && (r.log as unknown[]).length > 0 && (
                  <Box color="fg.muted" flexShrink={0}>
                    {expandedRows.has(i) ? <LuChevronDown size={12} /> : <LuChevronRight size={12} />}
                  </Box>
                )}
              </HStack>
              {showTrace && expandedRows.has(i) && r.log && (r.log as unknown[]).length > 0 && (
                <ToolCallTrace log={r.log as unknown[]} />
              )}
            </Box>
          ))}
        </VStack>
      </Box>
    );
  }

  if (variant === 'colored') {
    return (
      <VStack align="stretch" gap={2}>
        {results.map((r, i) => (
          <Box key={i}>
            <HStack
              gap={2}
              p={2}
              borderRadius="md"
              bg={r.passed ? 'green.subtle' : 'red.subtle'}
              cursor={showTrace && r.log && (r.log as unknown[]).length > 0 ? 'pointer' : undefined}
              onClick={showTrace && r.log && (r.log as unknown[]).length > 0 ? () => toggleRow(i) : undefined}
            >
              <TestResultBadge result={r} showDetails />
              <Text fontSize="xs" color="fg.muted" truncate flex={1}>{deriveLabel(r, i)}</Text>
              {showTrace && r.log && (r.log as unknown[]).length > 0 && (
                <Box color="fg.muted" flexShrink={0}>
                  {expandedRows.has(i) ? <LuChevronDown size={12} /> : <LuChevronRight size={12} />}
                </Box>
              )}
            </HStack>
            {showTrace && expandedRows.has(i) && r.log && (r.log as unknown[]).length > 0 && (
              <ToolCallTrace log={r.log as unknown[]} />
            )}
          </Box>
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
          <Box
            key={i}
            borderBottomWidth="1px"
            borderColor="border.muted"
            _last={{ borderBottom: 'none' }}
          >
            <HStack
              gap={2}
              px={3}
              py={2}
              cursor={showTrace && r.log && (r.log as unknown[]).length > 0 ? 'pointer' : undefined}
              onClick={showTrace && r.log && (r.log as unknown[]).length > 0 ? () => toggleRow(i) : undefined}
              _hover={showTrace && r.log && (r.log as unknown[]).length > 0 ? { bg: 'bg.muted' } : undefined}
            >
              <TestResultBadge result={r} showDetails />
              <Text fontSize="xs" color="fg.muted" truncate flex={1}>{deriveLabel(r, i)}</Text>
              {showTrace && r.log && (r.log as unknown[]).length > 0 && (
                <Box color="fg.muted" flexShrink={0}>
                  {expandedRows.has(i) ? <LuChevronDown size={12} /> : <LuChevronRight size={12} />}
                </Box>
              )}
            </HStack>
            {showTrace && expandedRows.has(i) && r.log && (r.log as unknown[]).length > 0 && (
              <Box px={3} pb={2}>
                <ToolCallTrace log={r.log as unknown[]} />
              </Box>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
