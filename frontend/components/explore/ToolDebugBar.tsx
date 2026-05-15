'use client';

import { useState, useMemo } from 'react';
import { HStack, Box, Text } from '@chakra-ui/react';
import { Button } from '@chakra-ui/react';
import { Tooltip } from '@/components/ui/tooltip';
import { LuTerminal, LuCheck, LuX } from 'react-icons/lu';
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

export default function ToolDebugBar({ messages }: ToolDebugBarProps) {
  const [showToolInspector, setShowToolInspector] = useState(false);
  const [inspecting, setInspecting] = useState<ToolCallTuple | null>(null);

  const toolCalls = useMemo(
    () => messages.filter((m): m is FlatToolCall & MessageWithFlags => m.role === 'tool'),
    [messages],
  );

  const branchColorMap = useMemo(
    () => buildBranchColorMap(toolCalls as Array<{ parent_id?: string }>),
    [toolCalls],
  );

  const hasBranches = branchColorMap.size > 1;

  if (messages.length === 0) return null;

  return (
    <>
      <HStack gap={2} px={3} py={1.5} mx={2} mt={1} bg="bg.canvas" border="1px solid" borderColor="border.muted" borderRadius="md" alignItems="flex-start">
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

        {/* Minimap: colored blocks grouped by run_id (same assistant message) */}
        {toolCalls.length > 0 && (
          <Box flex={1} minW={0} display="flex" flexWrap="wrap" gap="6px">
            {(() => {
              // Group tool calls by run_id
              const groups: (typeof toolCalls)[] = [];
              let currentGroup: typeof toolCalls = [];
              let currentRunId: string | undefined;
              for (const msg of toolCalls) {
                const runId = (msg as any).run_id;
                if (runId !== currentRunId && currentGroup.length > 0) {
                  groups.push(currentGroup);
                  currentGroup = [];
                }
                currentRunId = runId;
                currentGroup.push(msg);
              }
              if (currentGroup.length > 0) groups.push(currentGroup);

              return groups.map((group, gi) => (
                <HStack key={gi} gap={0.5} border="1px solid" borderColor="border.emphasized" borderRadius="sm" p={0.5}>
                  {group.map((msg, idx) => {
                    const name = msg.function.name;
                    const hasError = typeof msg.content === 'string' && msg.content.includes('"success":false');
                    const color = getToolColor(name);
                    const parentId = (msg as any).parent_id as string | undefined;
                    const branchColor = parentId ? branchColorMap.get(parentId) : undefined;

                    return (
                      <Tooltip key={`${msg.tool_call_id}-${idx}`} content={`${name}${hasBranches && parentId ? ` [${parentId}]` : ''}`} positioning={{ placement: 'bottom' }}>
                        <Box
                          w="24px"
                          h="48px"
                          cursor="pointer"
                          _hover={{ opacity: 1, transform: 'scaleY(1.1)' }}
                          transition="all 0.1s"
                          opacity={0.7}
                          display="flex"
                          flexDirection="column"
                          borderRadius="xs"
                          overflow="hidden"
                          onClick={() => setInspecting(toInspectTuple(msg))}
                        >
                          {/* Main tool color block */}
                          <Box
                            flex={1}
                            bg={color}
                            display="flex"
                            alignItems="center"
                            justifyContent="center"
                          >
                            {hasError
                              ? <LuX size={10} color="white" />
                              : <LuCheck size={10} color="white" />
                            }
                          </Box>
                          {/* Branch color underline */}
                          {hasBranches && (
                            <Box
                              h="4px"
                              flexShrink={0}
                              bg={branchColor ?? 'transparent'}
                            />
                          )}
                        </Box>
                      </Tooltip>
                    );
                  })}
                </HStack>
              ));
            })()}
          </Box>
        )}
      </HStack>

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
