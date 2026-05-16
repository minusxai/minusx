'use client';

import React, { useMemo, useState } from 'react';
import { Box, HStack, Text } from '@chakra-ui/react';
import { Button } from '@chakra-ui/react';
import { Tooltip } from '@/components/ui/tooltip';
import { LuGitFork, LuClock, LuTerminal, LuX } from 'react-icons/lu';
import ToolCallListModal from './ToolCallListModal';
import ToolInspectModal from './ToolInspectModal';
import { shortBranchLabel } from './ToolDebugBar';
import type { MessageWithFlags } from './message/messageHelpers';
import type { CompletedToolCall as ToolCallTuple, ToolCall, ToolMessage } from '@/lib/types';
import type { CompletedToolCall as FlatToolCall } from '@/store/chatSlice';

// ─── Types for PI log entries ────────────────────────────────────────────

interface PiLogEntry {
  type?: string;
  role?: string;
  id?: string;
  name?: string;
  content?: Array<{ type: string; id?: string; name?: string }>;
  parent_id: string | null;
  timestamp?: number;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  usage?: { cost?: { total?: number }; totalTokens?: number };
  details?: { type?: string; assistantMessage?: { usage?: { cost?: { total?: number } } } };
}

// ─── Tool colors (shared with ToolDebugBar) ──────────────────────────────

const TOOL_COLOR_MAP: Record<string, string> = {
  ExecuteQuery: 'accent.danger',
  CreateFile: 'accent.secondary',
  EditFile: 'accent.secondary',
  ReadFiles: 'accent.primary',
  SearchFiles: 'accent.warning',
  SearchDBSchema: 'accent.warning',
  FuzzyMatch: 'accent.primary',
  Navigate: 'accent.cyan',
  TalkToUser: 'fg.subtle',
  AnalystAgent: 'fg.subtle',
  AtlasAnalystAgent: 'fg.subtle',
  Clarify: 'accent.warning',
  ClarifyFrontend: 'accent.warning',
  PublishAll: 'accent.success',
  LoadSkill: 'accent.cyan',
  WebSearch: 'accent.primary',
  ExploreDataset: 'accent.primary',
  BenchmarkAnalystAgent: 'accent.teal',
  CheckEquivalence: 'accent.warning',
};

function getToolColor(name: string): string {
  return TOOL_COLOR_MAP[name] ?? 'fg.subtle';
}

// ─── Gantt row model ─────────────────────────────────────────────────────

interface GanttRow {
  id: string;
  label: string;
  shortId: string;       // Short version of the id for disambiguation
  parentId: string | null;
  startTs: number;
  endTs: number;
  durationMs: number;
  color: string;
  status: 'success' | 'error' | 'unknown';
  cost: number;
}

const PALETTE = [
  '#888888', '#3498db', '#e67e22', '#2ecc71', '#e74c3c',
  '#9b59b6', '#1abc9c', '#f1c40f', '#e84393',
];

function shortLabel(name: string): string {
  return name
    .replace(/BenchmarkAnalystAgent/g, 'Analyst')
    .replace(/DoubleCheckBenchmarkAgent/g, 'DoubleCheck')
    .replace(/CheckEquivalence/g, 'Judge')
    .replace(/ForDoubleCheck/g, '');
}

// ─── Build Gantt rows from PI log ────────────────────────────────────────

function buildGanttRows(log: PiLogEntry[]): GanttRow[] {
  const usedAsParent = new Set<string>();
  for (const entry of log) {
    if (entry.parent_id) usedAsParent.add(entry.parent_id);
  }

  const agentInvocations = new Map<string, { name: string; parentId: string | null }>();
  for (const entry of log) {
    if (entry.type === 'toolCall' && entry.id && entry.name) {
      agentInvocations.set(entry.id, { name: entry.name, parentId: entry.parent_id });
    }
  }

  for (const entry of log) {
    if (entry.role === 'assistant' && entry.content && entry.parent_id) {
      for (const block of entry.content) {
        if (block.type === 'toolCall' && block.id && block.name && usedAsParent.has(block.id)) {
          if (!agentInvocations.has(block.id)) {
            agentInvocations.set(block.id, { name: block.name, parentId: entry.parent_id });
          }
        }
      }
    }
  }

  const agentData = new Map<string, {
    name: string; parentId: string | null;
    minTs: number; maxTs: number; cost: number; status: 'success' | 'error' | 'unknown';
  }>();

  for (const [id, info] of agentInvocations) {
    agentData.set(id, { name: info.name, parentId: info.parentId, minTs: Infinity, maxTs: -Infinity, cost: 0, status: 'unknown' });
  }

  for (const entry of log) {
    if (!entry.parent_id || !entry.timestamp) continue;
    const data = agentData.get(entry.parent_id);
    if (!data) continue;
    if (entry.timestamp < data.minTs) data.minTs = entry.timestamp;
    if (entry.timestamp > data.maxTs) data.maxTs = entry.timestamp;
    if (entry.usage?.cost?.total) data.cost += entry.usage.cost.total;
  }

  for (const entry of log) {
    if (entry.role === 'toolResult' && entry.toolCallId && entry.timestamp) {
      const data = agentData.get(entry.toolCallId);
      if (data) {
        if (entry.timestamp > data.maxTs) data.maxTs = entry.timestamp;
        data.status = entry.isError ? 'error' : 'success';
        // Don't add cost from details.assistantMessage — it's already counted
        // via the assistant message entry in the parent_id scan above.
      }
    }
  }

  let colorIdx = 1;
  const colorByParent = new Map<string, number>();
  const rows: GanttRow[] = [];

  for (const [id, data] of agentData) {
    if (data.minTs === Infinity) continue;
    let color: string;
    if (data.parentId === null) {
      color = PALETTE[0];
    } else {
      if (!colorByParent.has(id)) colorByParent.set(id, colorIdx++);
      color = PALETTE[colorByParent.get(id)! % PALETTE.length];
    }
    rows.push({
      id, label: shortLabel(data.name), shortId: shortBranchLabel(id),
      parentId: data.parentId,
      startTs: data.minTs, endTs: data.maxTs, durationMs: data.maxTs - data.minTs,
      color, status: data.status, cost: data.cost,
    });
  }

  rows.sort((a, b) => {
    if (a.parentId === null && b.parentId !== null) return -1;
    if (a.parentId !== null && b.parentId === null) return 1;
    return a.startTs - b.startTs;
  });

  return rows;
}

// ─── Format helpers ──────────────────────────────────────────────────────

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cost: number): string {
  if (cost <= 0) return '';
  return `$${cost.toFixed(4)}`;
}

// ─── Inspect helpers ─────────────────────────────────────────────────────

type ToolCallMsg = FlatToolCall & MessageWithFlags;

function toInspectTuple(msg: FlatToolCall): ToolCallTuple {
  let args: Record<string, any> = {};
  try {
    args = typeof msg.function.arguments === 'string'
      ? JSON.parse(msg.function.arguments) : msg.function.arguments;
  } catch { /* */ }
  const toolCall: ToolCall = { id: msg.tool_call_id, type: 'function', function: { name: msg.function.name, arguments: args } };
  const toolMessage: ToolMessage = { role: 'tool', tool_call_id: msg.tool_call_id, content: msg.content, details: msg.details as ToolMessage['details'] };
  return [toolCall, toolMessage];
}

// ─── Main component ──────────────────────────────────────────────────────

interface ExecutionTreeProps {
  piLog: unknown[];
  messages: MessageWithFlags[];
}

const ZOOM_LEVELS = [
  { label: '1x', pxPerSec: 6 },
  { label: '2x', pxPerSec: 12 },
  { label: '4x', pxPerSec: 24 },
] as const;

export default function ExecutionTree({ piLog, messages }: ExecutionTreeProps) {
  const [showToolInspector, setShowToolInspector] = useState(false);
  const [inspecting, setInspecting] = useState<ToolCallTuple | null>(null);
  const [zoomIdx, setZoomIdx] = useState(0); // default to medium

  const rows = useMemo(() => buildGanttRows(piLog as PiLogEntry[]), [piLog]);

  const toolCalls = useMemo(
    () => messages.filter((m): m is ToolCallMsg => m.role === 'tool'),
    [messages],
  );

  // Build dispatch-time map from PI log: tool_call_id → timestamp of the
  // assistant message that emitted it (not the completion time).
  // This is needed because parallel tool calls share the same dispatch time
  // but complete at different times.
  const dispatchTimes = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of piLog as PiLogEntry[]) {
      if (entry.role === 'assistant' && entry.timestamp && entry.content) {
        for (const block of entry.content) {
          if (block.type === 'toolCall' && block.id) {
            map.set(block.id, entry.timestamp);
          }
        }
      }
    }
    return map;
  }, [piLog]);

  // Group tool calls by parent_id for placement in Gantt rows
  const toolCallsByParent = useMemo(() => {
    const map = new Map<string, ToolCallMsg[]>();
    for (const tc of toolCalls) {
      const pid = (tc as any).parent_id as string | undefined;
      if (!pid) continue;
      const arr = map.get(pid) ?? [];
      arr.push(tc);
      map.set(pid, arr);
    }
    return map;
  }, [toolCalls]);

  const SQ = 14;  // square size in px
  const SQ_GAP = 1; // vertical gap between stacked squares

  // Pre-compute per-row: group tool calls by dispatch time, find max parallel count
  // (must be before early returns to satisfy React hooks rules)
  const rowData = useMemo(() => rows.map((row) => {
    const rowToolCalls = toolCallsByParent.get(row.id) ?? [];
    const byTs = new Map<number, ToolCallMsg[]>();
    for (const tc of rowToolCalls) {
      const ts = dispatchTimes.get(tc.tool_call_id) ?? (tc.created_at ? Date.parse(tc.created_at) : 0);
      const arr = byTs.get(ts) ?? [];
      arr.push(tc);
      byTs.set(ts, arr);
    }
    const groups = Array.from(byTs.entries())
      .sort(([a], [b]) => a - b)
      .map(([ts, calls]) => ({ ts, calls }));
    const maxParallel = groups.reduce((m, g) => Math.max(m, g.calls.length), 1);
    const rowH = maxParallel * SQ + (maxParallel - 1) * SQ_GAP + 2; // 1px padding top+bottom
    return { row, rowToolCalls, groups, maxParallel, rowH };
  }), [rows, toolCallsByParent, dispatchTimes]);

  // Early returns after all hooks
  if (rows.length < 2) return null;

  const globalStart = Math.min(...rows.map(r => r.startTs));
  const globalEnd = Math.max(...rows.map(r => r.endTs));
  const totalMs = globalEnd - globalStart;
  if (totalMs <= 0) return null;

  // Chart width scales with zoom level
  const pxPerSec = ZOOM_LEVELS[zoomIdx].pxPerSec;
  const chartMinW = (totalMs / 1000) * pxPerSec;

  // Pick time marker step so labels are ~60px apart minimum
  const MIN_LABEL_GAP_PX = 100;
  const minStepSec = MIN_LABEL_GAP_PX / pxPerSec;
  const NICE_STEPS = [5, 10, 15, 30, 60, 120, 300, 600];
  const niceStepSec = NICE_STEPS.find(s => s >= minStepSec) ?? 600;
  const markers: number[] = [];
  for (let t = 0; t <= totalMs; t += niceStepSec * 1000) markers.push(t);

  // Count actual tool calls (exclude TalkToUser/agent calls) for display
  const actualToolCallCount = toolCalls.filter(tc => {
    const name = tc.function.name;
    return !name.includes('Agent') && name !== 'TalkToUser' && name !== 'CheckEquivalence';
  }).length;

  // Total cost across all agents
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);

  return (
    <>
      <Box
        mx={2}
        mt={1}
        border="1px solid"
        borderColor="border.muted"
        borderRadius="md"
        bg="bg.canvas"
        overflow="hidden"
      >
        {/* Header */}
        <HStack
          px={3} py={1.5}
          bg="bg.elevated"
          borderBottom="1px solid"
          borderColor="border.default"
          gap={2}
        >
          <LuGitFork size={12} color="#888" style={{ transform: 'rotate(180deg)' }} />
          <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="600" textTransform="uppercase" letterSpacing="wider">
            Execution Timeline
          </Text>
          <HStack gap={0.5}>
            <LuClock size={10} color="#888" />
            <Text fontSize="2xs" fontFamily="mono" color="fg.muted">{formatMs(totalMs)}</Text>
          </HStack>
          {totalCost > 0 && (
            <Text fontSize="2xs" fontFamily="mono" color="fg.muted">{formatCost(totalCost)}</Text>
          )}
          <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">
            {rows.length} agents · {actualToolCallCount} tool calls
          </Text>
          <Box flex={1} />
          {/* Zoom control */}
          <HStack gap={0} border="1px solid" borderColor="border.muted" borderRadius="sm" overflow="hidden">
            {ZOOM_LEVELS.map((level, i) => (
              <Box
                key={i}
                as="button"
                aria-label={`Zoom ${level.label}`}
                onClick={() => setZoomIdx(i)}
                px={2} py={0.5}
                fontSize="2xs" fontFamily="mono" fontWeight={i === zoomIdx ? '700' : '400'}
                color={i === zoomIdx ? 'accent.teal' : 'fg.subtle'}
                bg={i === zoomIdx ? 'accent.teal/12' : 'transparent'}
                cursor="pointer"
                _hover={{ bg: i === zoomIdx ? 'accent.teal/12' : 'bg.muted' }}
                borderRight={i < ZOOM_LEVELS.length - 1 ? '1px solid' : 'none'}
                borderColor="border.muted"
                transition="all 0.1s"
              >
                {level.label}
              </Box>
            ))}
          </HStack>
          <Tooltip content="Inspect all tool calls" positioning={{ placement: 'bottom' }}>
            <Button onClick={() => setShowToolInspector(true)} size="xs" variant="outline" borderColor="border.muted">
              <LuTerminal />
            </Button>
          </Tooltip>
        </HStack>

        {/* Gantt chart — scrollable */}
        <Box px={3} py={2} overflowX="auto">
          <Box style={{ width: `${chartMinW}px` }}>
          {/* Time axis */}
          <HStack gap={0} position="relative" h="14px" mb={1} ml="130px">
            {markers.map((ms, i) => (
              <Text
                key={i} position="absolute" left={`${(ms / totalMs) * 100}%`}
                fontSize="2xs" fontFamily="mono" color="fg.subtle"
                transform="translateX(-50%)" whiteSpace="nowrap"
              >
                {formatMs(ms)}
              </Text>
            ))}
          </HStack>

          {/* Rows */}
          {rowData.map(({ row, groups, rowH }) => {
            const leftPct = ((row.startTs - globalStart) / totalMs) * 100;
            const widthPct = Math.max((row.durationMs / totalMs) * 100, 0.5);

            return (
              <HStack key={row.id} gap={0} h={`${rowH}px`} my="1px" align="stretch">
                {/* Label with short ID + stats */}
                <Box
                  w="130px" flexShrink={0} pr={2} textAlign="right"
                  borderRight="1px solid" borderColor="border.default"
                  display="flex" flexDirection="column" justifyContent="center"
                  alignItems="flex-end"
                >
                  <Text fontSize="2xs" fontFamily="mono" fontWeight="600" color={row.color} truncate title={`${row.label} (${row.id})`} lineHeight="1.3">
                    {row.label}
                    {row.parentId !== null && (
                      <Text as="span" color="fg.subtle" fontWeight="400"> {row.shortId}</Text>
                    )}
                  </Text>
                  <Text fontSize="9px" fontFamily="mono" color="fg.subtle" lineHeight="1.2" truncate>
                    {formatMs(row.durationMs)}{row.cost > 0 ? ` · ${formatCost(row.cost)}` : ''}
                  </Text>
                </Box>

                {/* Bar area */}
                <Box flex={1} position="relative" bg="bg.subtle" borderRadius="sm">
                  {/* Grid lines */}
                  {markers.map((ms, i) => (
                    <Box key={i} position="absolute" left={`${(ms / totalMs) * 100}%`} top={0} h="100%" w="1px" bg="border.default" opacity={0.3} />
                  ))}

                  {/* Background bar */}
                  <Box
                    position="absolute"
                    left={`${leftPct}%`}
                    w={`${widthPct}%`}
                    h="100%"
                    bg={`${row.color}15`}
                    borderRadius="3px"
                  />

                  {/* Tool call duration bars — each bar spans dispatch → completion.
                      Parallel calls (same dispatch time) stack vertically. */}
                  {groups.map((group) => {
                    if (!group.ts) return null;

                    return group.calls.map((tc, tci) => {
                      const name = tc.function.name;
                      const hasError = typeof tc.content === 'string' && tc.content.includes('"success":false');
                      const toolColor = getToolColor(name);

                      const dispatchTs = group.ts;
                      const completeTs = tc.created_at ? Date.parse(tc.created_at) : dispatchTs;
                      const tcLeftPct = ((dispatchTs - globalStart) / totalMs) * 100;
                      const tcDur = Math.max(completeTs - dispatchTs, 0);
                      // Min visible width = 2 seconds worth of pixels
                      const minWidthPct = (1000 / totalMs) * 100;
                      const tcWidthPct = Math.max((tcDur / totalMs) * 100, minWidthPct);
                      // Vertical position: stack by index within the group
                      const topPx = 1 + tci * (SQ + SQ_GAP);

                      return (
                        <Tooltip key={`${tc.tool_call_id}-${tci}`} content={`${name} — ${formatMs(tcDur)}${group.calls.length > 1 ? ` (${group.calls.length} parallel)` : ''}`} positioning={{ placement: 'top' }}>
                          <Box
                            position="absolute"
                            left={`${tcLeftPct}%`}
                            top={`${topPx}px`}
                            w={`${tcWidthPct}%`}
                            h={`${SQ}px`}
                            bg={toolColor}
                            opacity={0.8}
                            cursor="pointer"
                            _hover={{ opacity: 1 }}
                            transition="all 0.1s"
                            borderRadius="xs"
                            onClick={() => setInspecting(toInspectTuple(tc))}
                            zIndex={1}
                            overflow="hidden"
                            display="flex"
                            alignItems="center"
                            justifyContent="center"
                          >
                            {hasError && (
                              <Box
                                w="10px" h="10px" borderRadius="full"
                                bg="white" display="flex" alignItems="center" justifyContent="center"
                                flexShrink={0}
                              >
                                <LuX size={7} color="#e74c3c" strokeWidth={5} />
                              </Box>
                            )}
                          </Box>
                        </Tooltip>
                      );
                    });
                  })}

                  {/* Duration label for rows without tool calls */}
                  {groups.length === 0 && (
                    <Box
                      position="absolute"
                      left={`${leftPct}%`}
                      h="100%"
                      display="flex"
                      alignItems="center"
                      pl="8px"
                      gap="4px"
                    >
                      <Box w="5px" h="5px" borderRadius="full" flexShrink={0}
                        bg={row.status === 'error' ? '#e74c3c' : row.status === 'success' ? '#2ecc71' : '#f1c40f'}
                      />
                      <Text fontSize="2xs" fontFamily="mono" color={row.color} fontWeight="500" whiteSpace="nowrap">
                        {formatMs(row.durationMs)}
                      </Text>
                    </Box>
                  )}
                </Box>
              </HStack>
            );
          })}
          </Box>{/* close minWidth wrapper */}
        </Box>
      </Box>

      <ToolCallListModal messages={messages} isOpen={showToolInspector} onClose={() => setShowToolInspector(false)} />
      {inspecting && (
        <ToolInspectModal toolCall={inspecting[0]} toolMessage={inspecting[1]} isOpen={!!inspecting} onClose={() => setInspecting(null)} />
      )}
    </>
  );
}
