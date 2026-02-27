'use client';

import { useState, useEffect } from 'react';
import { Box, HStack, VStack, Text, IconButton, Icon, Badge, Spinner } from '@chakra-ui/react';
import { LuBug, LuChevronDown, LuChevronRight, LuClock, LuCpu } from 'react-icons/lu';
import type { MessageDebugInfo } from '@/lib/types';
import { useAppSelector } from '@/store/hooks';
import { selectShowDebug } from '@/store/uiSlice';
import { selectEffectiveUser } from '@/store/authSlice';
import { isAdmin } from '@/lib/auth/role-helpers';
import { getLLMLogStats, type LLMLogStats } from '@/lib/api/llm-calls';

interface DebugInfoDisplayProps {
  debugInfo: MessageDebugInfo;
}

function StatsTable({ stats }: { stats: Record<string, unknown> }) {
  const rows = Object.entries(stats).filter(([k]) => k !== 'id');
  return (
    <Box overflowX="auto">
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {rows.map(([key, value]) => (
            <tr key={key}>
              <td style={{ padding: '1px 12px 1px 0', whiteSpace: 'nowrap', verticalAlign: 'top', opacity: 0.6, fontFamily: 'monospace', fontSize: '11px' }}>
                {key}
              </td>
              <td style={{ padding: '1px 0', fontFamily: 'monospace', fontSize: '11px', wordBreak: 'break-all' }}>
                {String(value ?? '—')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  );
}

function JsonSection({ title, raw }: { title: string; raw: string }) {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = raw; }
  return (
    <Box>
      <Text fontSize="2xs" fontWeight="600" color="fg.muted" mb={0.5}>{title}</Text>
      <Box p={1.5} bg="bg.surface" borderRadius="sm" fontFamily="mono" fontSize="2xs" overflowX="auto" maxH="300px" overflowY="auto">
        <pre>{JSON.stringify(parsed, null, 2)}</pre>
      </Box>
    </Box>
  );
}

/**
 * Component to load and display LLM call details from MX proxy API
 */
function LLMCallMXDetails({ llmCallId }: { llmCallId: string }) {
  const [data, setData] = useState<LLMLogStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (fetched) return;
    setFetched(true);
    setLoading(true);
    getLLMLogStats(llmCallId)
      .then((result) => setData(result))
      .finally(() => setLoading(false));
  }, [llmCallId, fetched]);

  if (loading) {
    return (
      <HStack gap={2} p={2} justify="center">
        <Spinner size="sm" />
        <Text fontSize="2xs" color="fg.subtle">Loading request/response...</Text>
      </HStack>
    );
  }

  if (!data || (!data.stats && !data.logs)) {
    return (
      <Text fontSize="2xs" color="fg.subtle" fontStyle="italic">
        Not available
      </Text>
    );
  }

  const requestBody = data.logs?.request_body as string | undefined;
  const responseBody = data.logs?.response_body as string | undefined;

  return (
    <VStack gap={2} align="stretch">
      {data.stats && <StatsTable stats={data.stats} />}
      {requestBody && <JsonSection title="Request" raw={requestBody} />}
      {responseBody && <JsonSection title="Response" raw={responseBody} />}
    </VStack>
  );
}

/**
 * Admin-only debug information display for chat messages
 * Shows LLM metrics, token counts, costs, and full request/response data
 * Collapsed by default with expandable sections
 */
export default function DebugInfoDisplay({ debugInfo }: DebugInfoDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedLLM, setExpandedLLM] = useState<number | null>(null);

  // Check if user is admin and debug is enabled
  const effectiveUser = useAppSelector(selectEffectiveUser);
  const isUserAdmin = effectiveUser?.role && isAdmin(effectiveUser.role);
  const showDebug = useAppSelector(selectShowDebug);

  // Don't render if not admin or debug is disabled
  if (!isUserAdmin || !showDebug) {
    return null;
  }

  // Calculate totals
  const totalTokens = debugInfo.llmDebug.reduce((sum, llm) => sum + llm.total_tokens, 0);
  const totalCost = debugInfo.llmDebug.reduce((sum, llm) => sum + llm.cost, 0);
  const totalLLMDuration = debugInfo.llmDebug.reduce((sum, llm) => sum + llm.duration, 0);

  // Format duration (ms vs seconds)
  const formatDuration = (seconds: number) => {
    if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
    return `${seconds.toFixed(2)}s`;
  };

  // Format cost
  const formatCost = (cost: number) => {
    if (cost < 0.001) return `$${(cost * 1000).toFixed(5)}k`;
    if (cost < 0.01) return `$${(cost * 1000).toFixed(4)}k`;
    return `$${cost.toFixed(4)}`;
  };

  return (
    <Box
      my={2}
      border="1px solid"
      borderColor="border.default"
      borderRadius="md"
      bg="bg.muted/30"
      overflow="hidden"
    >
      {/* Header - Collapsed Summary */}
      <HStack
        p={2}
        cursor="pointer"
        onClick={() => setIsExpanded(!isExpanded)}
        _hover={{ bg: 'bg.muted/50' }}
        gap={2}
      >
        <IconButton
          aria-label="Toggle debug info"
          size="xs"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
        >
          {isExpanded ? <LuChevronDown /> : <LuChevronRight />}
        </IconButton>

        <Icon as={LuBug} boxSize={3} color="fg.muted" />

        <Text fontSize="xs" fontWeight="600" color="fg.muted" fontFamily="mono">
          Debug Info
        </Text>

        {/* Quick Stats */}
        <HStack gap={3} ml="auto" fontSize="xs" fontFamily="mono" color="fg.subtle">
          <HStack gap={1}>
            <Icon as={LuClock} boxSize={3} />
            <Text>{formatDuration(debugInfo.duration)}</Text>
          </HStack>

          <HStack gap={1}>
            <Icon as={LuCpu} boxSize={3} />
            <Text>{totalTokens.toLocaleString()} tok</Text>
          </HStack>

          <HStack gap={1}>
            <Text>{formatCost(totalCost)}</Text>
          </HStack>

          <Badge size="xs" colorPalette="gray">
            {debugInfo.llmDebug.length} call{debugInfo.llmDebug.length !== 1 ? 's' : ''}
          </Badge>
        </HStack>
      </HStack>

      {/* Expanded Details */}
      {isExpanded && (
        <VStack gap={2} p={3} pt={0} align="stretch" bg="bg.canvas">
          {/* Task Duration Breakdown */}
          <Box>
            <Text fontSize="xs" fontWeight="600" color="fg.muted" mb={1}>
              Task Duration
            </Text>
            <HStack gap={2} fontSize="xs" fontFamily="mono">
              <Text>Total: {formatDuration(debugInfo.duration)}</Text>
              <Text color="fg.subtle">|</Text>
              <Text>LLM: {formatDuration(totalLLMDuration)}</Text>
              <Text color="fg.subtle">|</Text>
              <Text>Overhead: {formatDuration(debugInfo.duration - totalLLMDuration)}</Text>
            </HStack>
          </Box>

          {/* LLM Calls */}
          <Box>
            <Text fontSize="xs" fontWeight="600" color="fg.muted" mb={1}>
              LLM Calls ({debugInfo.llmDebug.length})
            </Text>

            <VStack gap={1} align="stretch">
              {debugInfo.llmDebug.map((llm, index) => (
                <Box
                  key={index}
                  border="1px solid"
                  borderColor="border.default"
                  borderRadius="sm"
                  bg="bg.surface"
                  overflow="hidden"
                >
                  {/* LLM Call Header */}
                  <HStack
                    p={2}
                    cursor="pointer"
                    onClick={() => setExpandedLLM(expandedLLM === index ? null : index)}
                    _hover={{ bg: 'bg.muted' }}
                    gap={2}
                    fontSize="xs"
                  >
                    <IconButton
                      aria-label="Toggle LLM details"
                      size="xs"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedLLM(expandedLLM === index ? null : index);
                      }}
                    >
                      {expandedLLM === index ? <LuChevronDown /> : <LuChevronRight />}
                    </IconButton>

                    <Text fontWeight="600" fontFamily="mono" flex="1">
                      {llm.model}
                    </Text>

                    <HStack gap={2} fontSize="2xs" color="fg.subtle">
                      <Text>{formatDuration(llm.duration)}</Text>
                      <Text>•</Text>
                      <Text>{llm.total_tokens.toLocaleString()} tok</Text>
                      <Text>•</Text>
                      <Text>{formatCost(llm.cost)}</Text>
                    </HStack>
                  </HStack>

                  {/* LLM Call Details */}
                  {expandedLLM === index && (
                    <VStack gap={2} p={2} pt={0} align="stretch" bg="bg.canvas" fontSize="xs">
                      {/* Token Breakdown */}
                      <Box>
                        <Text fontSize="2xs" fontWeight="600" color="fg.muted" mb={0.5}>
                          Tokens
                        </Text>
                        <HStack gap={2} fontFamily="mono" fontSize="2xs">
                          <Text>Prompt: {llm.prompt_tokens.toLocaleString()}</Text>
                          <Text>•</Text>
                          <Text>Completion: {llm.completion_tokens.toLocaleString()}</Text>
                          <Text>•</Text>
                          <Text>Total: {llm.total_tokens.toLocaleString()}</Text>
                        </HStack>
                      </Box>

                      {/* Finish Reason */}
                      {llm.finish_reason && (
                        <Box>
                          <Text fontSize="2xs" fontWeight="600" color="fg.muted" mb={0.5}>
                            Finish Reason
                          </Text>
                          <Text fontFamily="mono" fontSize="2xs">{llm.finish_reason}</Text>
                        </Box>
                      )}

                      {/* LLM Call ID */}
                      {llm.lllm_call_id && (
                        <Box>
                          <Text fontSize="2xs" fontWeight="600" color="fg.muted" mb={0.5}>
                            LLM Call ID
                          </Text>
                          <Text fontFamily="mono" fontSize="2xs" wordBreak="break-all">
                            {llm.lllm_call_id}
                          </Text>
                        </Box>
                      )}

                      {/* LLLM Overhead */}
                      {llm.lllm_overhead_time_ms !== undefined && (
                        <Box>
                          <Text fontSize="2xs" fontWeight="600" color="fg.muted" mb={0.5}>
                            LLLM Overhead
                          </Text>
                          <Text fontFamily="mono" fontSize="2xs">
                            {llm.lllm_overhead_time_ms.toFixed(2)}ms
                          </Text>
                        </Box>
                      )}

                      {/* Token Details */}
                      {(llm.prompt_tokens_details || llm.completion_tokens_details) && (
                        <Box>
                          <Text fontSize="2xs" fontWeight="600" color="fg.muted" mb={0.5}>
                            Token Details
                          </Text>
                          <Box
                            p={1.5}
                            bg="bg.surface"
                            borderRadius="sm"
                            fontFamily="mono"
                            fontSize="2xs"
                            overflowX="auto"
                          >
                            <pre>
                              {JSON.stringify(
                                {
                                  prompt: llm.prompt_tokens_details,
                                  completion: llm.completion_tokens_details
                                },
                                null,
                                2
                              )}
                            </pre>
                          </Box>
                        </Box>
                      )}

                      {/* Stats + Request/Response from backend */}
                      {llm.lllm_call_id && (
                        <LLMCallMXDetails llmCallId={llm.lllm_call_id} />
                      )}
                    </VStack>
                  )}
                </Box>
              ))}
            </VStack>
          </Box>

          {/* Extra Task Data */}
          {debugInfo.extra && (
            <Box>
              <Text fontSize="xs" fontWeight="600" color="fg.muted" mb={1}>
                Extra Data
              </Text>
              <Box
                p={2}
                bg="bg.surface"
                borderRadius="sm"
                fontFamily="mono"
                fontSize="xs"
                overflowX="auto"
                maxH="200px"
                overflowY="auto"
              >
                <pre>{JSON.stringify(debugInfo.extra, null, 2)}</pre>
              </Box>
            </Box>
          )}
        </VStack>
      )}
    </Box>
  );
}
