'use client';

import { useState, useMemo } from 'react';
import { HStack, Box, Text, VStack } from '@chakra-ui/react';
import { Button } from '@chakra-ui/react';
import { Tooltip } from '@/components/ui/tooltip';
import { LuTerminal, LuCheck, LuX, LuGitFork } from 'react-icons/lu';
import ToolCallListModal from './ToolCallListModal';
import ToolInspectModal from './ToolInspectModal';
import type { MessageWithFlags } from './message/messageHelpers';
import type { CompletedToolCall as ToolCallTuple, ToolCall, ToolMessage } from '@/lib/types';
import type { CompletedToolCall as FlatToolCall } from '@/store/chatSlice';

interface ToolDebugBarProps {
  messages: MessageWithFlags[];
}

/** Tool colors using theme accent tokens */
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
};

/** Palette for distinguishing parallel branches */
const BRANCH_COLORS = [
  '#3498db', // blue
  '#e67e22', // orange
  '#2ecc71', // green
  '#e74c3c', // red
  '#9b59b6', // purple
  '#1abc9c', // teal
  '#f1c40f', // yellow
  '#e84393', // pink
];

function getToolColor(name: string): string {
  return TOOL_COLOR_MAP[name] ?? 'fg.subtle';
}

/** Build a map of parent_id -> color for branch visualization */
export function buildBranchColorMap(messages: Array<{ parent_id?: string }>): Map<string, string> {
  const parentIds = new Set<string>();
  for (const msg of messages) {
    if (msg.parent_id) parentIds.add(msg.parent_id);
  }
  const map = new Map<string, string>();
  let idx = 0;
  for (const pid of parentIds) {
    map.set(pid, BRANCH_COLORS[idx % BRANCH_COLORS.length]);
    idx++;
  }
  return map;
}

/** Shorten a parent_id for display (e.g. "r1-agent1" → "agent1") */
export function shortBranchLabel(parentId: string): string {
  // Take last segment after the last dash, or last 8 chars
  const parts = parentId.split('-');
  return parts.length > 1 ? parts[parts.length - 1] : parentId.slice(-8);
}

type ToolCallMsg = FlatToolCall & MessageWithFlags;

/** A segment in the debug bar: either trunk tools or a branched group */
type DebugBarSegment =
  | { kind: 'trunk'; groups: ToolCallMsg[][] }
  | { kind: 'branches'; branches: Array<{ parentId: string; color: string; groups: ToolCallMsg[][] }> };

/** Group tool calls by run_id */
function groupByRunId(calls: ToolCallMsg[]): ToolCallMsg[][] {
  const groups: ToolCallMsg[][] = [];
  let current: ToolCallMsg[] = [];
  let currentRunId: string | undefined;
  for (const msg of calls) {
    const runId = (msg as any).run_id;
    if (runId !== currentRunId && current.length > 0) {
      groups.push(current);
      current = [];
    }
    currentRunId = runId;
    current.push(msg);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** Build segments: trunk items stay flat; consecutive branched items get grouped by branch */
function buildDebugBarSegments(
  toolCalls: ToolCallMsg[],
  branchColorMap: Map<string, string>,
): DebugBarSegment[] {
  if (branchColorMap.size < 2) {
    // No branching — everything is trunk
    return [{ kind: 'trunk', groups: groupByRunId(toolCalls) }];
  }

  const segments: DebugBarSegment[] = [];
  let trunkBuffer: ToolCallMsg[] = [];
  let branchBuffer: ToolCallMsg[] = [];

  const flushTrunk = () => {
    if (trunkBuffer.length > 0) {
      segments.push({ kind: 'trunk', groups: groupByRunId(trunkBuffer) });
      trunkBuffer = [];
    }
  };

  const flushBranches = () => {
    if (branchBuffer.length > 0) {
      // Group by parent_id
      const byParent = new Map<string, ToolCallMsg[]>();
      for (const msg of branchBuffer) {
        const pid = (msg as any).parent_id as string;
        const arr = byParent.get(pid) ?? [];
        arr.push(msg);
        byParent.set(pid, arr);
      }
      const branches = Array.from(byParent.entries()).map(([parentId, calls]) => ({
        parentId,
        color: branchColorMap.get(parentId) ?? '#888',
        groups: groupByRunId(calls),
      }));
      segments.push({ kind: 'branches', branches });
      branchBuffer = [];
    }
  };

  for (const msg of toolCalls) {
    const pid = (msg as any).parent_id as string | undefined;
    const isBranched = pid && branchColorMap.has(pid);
    if (isBranched) {
      flushTrunk();
      branchBuffer.push(msg);
    } else {
      flushBranches();
      trunkBuffer.push(msg);
    }
  }
  flushTrunk();
  flushBranches();

  return segments;
}

function toInspectTuple(msg: FlatToolCall): ToolCallTuple {
  let args: Record<string, any> = {};
  try {
    args = typeof msg.function.arguments === 'string'
      ? JSON.parse(msg.function.arguments)
      : msg.function.arguments;
  } catch { /* leave args as {} */ }

  const toolCall: ToolCall = {
    id: msg.tool_call_id,
    type: 'function',
    function: { name: msg.function.name, arguments: args },
  };
  const toolMessage: ToolMessage = {
    role: 'tool',
    tool_call_id: msg.tool_call_id,
    content: msg.content,
    details: msg.details as ToolMessage['details'],
  };
  return [toolCall, toolMessage];
}

/** Render a single tool call square */
function ToolSquare({ msg, onClick }: { msg: ToolCallMsg; onClick: () => void }) {
  const name = msg.function.name;
  const hasError = typeof msg.content === 'string' && msg.content.includes('"success":false');
  const color = getToolColor(name);

  return (
    <Tooltip content={name} positioning={{ placement: 'bottom' }}>
      <Box
        w="20px"
        h="20px"
        bg={color}
        cursor="pointer"
        _hover={{ opacity: 1, transform: 'scale(1.15)' }}
        transition="all 0.1s"
        opacity={0.75}
        display="flex"
        alignItems="center"
        justifyContent="center"
        onClick={onClick}
        borderRadius="2px"
      >
        {hasError
          ? <LuX size={9} color="white" />
          : <LuCheck size={9} color="white" />
        }
      </Box>
    </Tooltip>
  );
}

/** Render a run_id group of tool squares */
function RunGroup({ group, onInspect }: { group: ToolCallMsg[]; onInspect: (msg: ToolCallMsg) => void }) {
  return (
    <HStack gap="2px" border="1px solid" borderColor="border.emphasized" borderRadius="sm" p="2px">
      {group.map((msg, idx) => (
        <ToolSquare key={`${msg.tool_call_id}-${idx}`} msg={msg} onClick={() => onInspect(msg)} />
      ))}
    </HStack>
  );
}

export default function ToolDebugBar({ messages }: ToolDebugBarProps) {
  const [showToolInspector, setShowToolInspector] = useState(false);
  const [inspecting, setInspecting] = useState<ToolCallTuple | null>(null);

  const toolCalls = useMemo(
    () => messages.filter((m): m is ToolCallMsg => m.role === 'tool'),
    [messages],
  );

  const branchColorMap = useMemo(
    () => buildBranchColorMap(toolCalls as Array<{ parent_id?: string }>),
    [toolCalls],
  );

  const hasBranches = branchColorMap.size > 1;

  const segments = useMemo(
    () => buildDebugBarSegments(toolCalls, branchColorMap),
    [toolCalls, branchColorMap],
  );

  const handleInspect = (msg: ToolCallMsg) => setInspecting(toInspectTuple(msg));

  if (messages.length === 0) return null;

  return (
    <>
      <Box px={3} py={1.5} mx={2} mt={1} bg="bg.canvas" border="1px solid" borderColor="border.muted" borderRadius="md">
        <HStack gap={2} alignItems="flex-start" mb={hasBranches ? 1 : 0}>
          <Tooltip content="Inspect tool calls" positioning={{ placement: 'bottom' }}>
            <Button
              onClick={() => setShowToolInspector(true)}
              size="xs"
              variant="outline"
              borderColor="border.muted"
              flexShrink={0}
            >
              <LuTerminal />
            </Button>
          </Tooltip>
          <Box flexShrink={0}>
            <Text fontSize="2xs" color="fg.subtle" fontWeight="semibold" textTransform="uppercase" letterSpacing="wider">
              {toolCalls.length} tool calls
            </Text>
            <Text fontSize="2xs" color="fg.subtle" letterSpacing="wider">
              {new Set(toolCalls.map(m => (m as any).run_id)).size} LLM turns
            </Text>
          </Box>

          {/* Non-branched: simple flat layout */}
          {!hasBranches && toolCalls.length > 0 && (
            <Box flex={1} minW={0} display="flex" flexWrap="wrap" gap="4px" alignItems="center">
              {segments[0]?.kind === 'trunk' && segments[0].groups.map((group, gi) => (
                <RunGroup key={gi} group={group} onInspect={handleInspect} />
              ))}
            </Box>
          )}
        </HStack>

        {/* Branched: structured layout with fork/merge */}
        {hasBranches && toolCalls.length > 0 && (
          <VStack gap={0} align="stretch" mt={1}>
            {segments.map((seg, si) => {
              if (seg.kind === 'trunk') {
                return (
                  <Box key={si} display="flex" flexWrap="wrap" gap="4px" alignItems="center" py={1}>
                    {seg.groups.map((group, gi) => (
                      <RunGroup key={gi} group={group} onInspect={handleInspect} />
                    ))}
                  </Box>
                );
              }

              // Branched segment — render each branch as a lane
              return (
                <Box key={si} position="relative" py={1}>
                  {/* Fork indicator */}
                  <HStack gap={1} mb={1.5} align="center">
                    <LuGitFork size={10} color="#666" style={{ transform: 'rotate(180deg)' }} />
                    <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="500">
                      {seg.branches.length} parallel branches
                    </Text>
                  </HStack>

                  <VStack gap={1} align="stretch" pl={2}>
                    {seg.branches.map((branch) => (
                      <Box
                        key={branch.parentId}
                        borderLeft="3px solid"
                        borderColor={branch.color}
                        pl={2}
                        py={1}
                        borderRadius="0 4px 4px 0"
                        bg={`${branch.color}08`}
                      >
                        <Text
                          fontSize="2xs"
                          fontFamily="mono"
                          fontWeight="600"
                          color={branch.color}
                          mb={1}
                          letterSpacing="0.02em"
                        >
                          {shortBranchLabel(branch.parentId)}
                        </Text>
                        <Box display="flex" flexWrap="wrap" gap="4px" alignItems="center">
                          {branch.groups.map((group, gi) => (
                            <RunGroup key={gi} group={group} onInspect={handleInspect} />
                          ))}
                        </Box>
                      </Box>
                    ))}
                  </VStack>

                  {/* Merge indicator */}
                  <HStack gap={1} mt={1.5} align="center">
                    <LuGitFork size={10} color="#666" />
                    <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="500">
                      merge
                    </Text>
                  </HStack>
                </Box>
              );
            })}
          </VStack>
        )}
      </Box>

      <ToolCallListModal
        messages={messages}
        isOpen={showToolInspector}
        onClose={() => setShowToolInspector(false)}
      />

      {inspecting && (
        <ToolInspectModal
          toolCall={inspecting[0]}
          toolMessage={inspecting[1]}
          isOpen={!!inspecting}
          onClose={() => setInspecting(null)}
        />
      )}
    </>
  );
}
