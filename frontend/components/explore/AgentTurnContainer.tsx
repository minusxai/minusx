'use client';

import React, { useMemo, useState } from 'react';
import { Box, HStack, VStack, Text, Icon } from '@chakra-ui/react';
import { LuBrain, LuDatabase } from 'react-icons/lu';
import type { Turn } from './message/groupIntoTurns';
import type { MessageWithFlags } from './message/messageHelpers';
import SimpleChatMessage from './SimpleChatMessage';
import ToolChips from './tools/ToolChips';
import ChartCarousel from './tools/ChartCarousel';
import DetailCarousel, { type DetailCardProps, getToolNameFromMsg } from './tools/DetailCarousel';
import { NavigateDetailCard } from './tools/NavigateDisplay';
import { PublishAllDetailCard } from './tools/PublishAllDisplay';
import { LoadSkillDetailCard } from './tools/LoadSkillDisplay';
import { SearchFilesDetailCard } from './tools/SearchFilesDisplay';
import { SearchDBSchemaDetailCard } from './tools/SearchDBSchemaDisplay';
import { FileDetailCard } from './tools/CreateFileDisplay';
import { EditFileDetailCard } from './tools/EditFileDisplay';
import { ReadFilesDetailCard } from './tools/ReadFilesDisplay';
import { getToolConfig } from '@/lib/api/tool-config';
import { ToolNames } from '@/lib/types';
import { immutableSet } from '@/lib/utils/immutable-collections';
import { useAppSelector } from '@/store/hooks';
import Markdown from '../Markdown';
import type { QueryResult } from '@/lib/types';

interface AgentTurnContainerProps {
  turn: Turn;
  isCompact: boolean;
  databaseName: string;
  showThinking: boolean;
  toggleShowThinking: () => void;
  markdownContext: 'sidebar' | 'mainpage';
  readOnly: boolean;
  conversationID?: number;
  viewMode?: import('@/lib/types').ChatViewMode;
}

function getToolName(msg: MessageWithFlags): string {
  if (msg.role !== 'tool') return '';
  return (msg as any).function?.name || '';
}

const CHAT_TOOLS: ReadonlySet<string> = immutableSet([
  ToolNames.TALK_TO_USER,
  ToolNames.ANALYST_AGENT,
  ToolNames.ATLAS_ANALYST_AGENT,
  ToolNames.TEST_AGENT,
  ToolNames.ONBOARDING_CONTEXT_AGENT,
  ToolNames.ONBOARDING_DASHBOARD_AGENT,
  ToolNames.SLACK_AGENT,
]);

// ─── Timeline node types ───────────────────────────────────────────

type TimelineNodeType = 'agent' | 'query' | 'tool';

interface TimelineNode {
  type: TimelineNodeType;
  icon: React.ComponentType;
  label: string;          // e.g. "created", "edited", "query"
  verb: string;           // e.g. "Creating", "Editing", "Executing"
  count: number;
  messages: MessageWithFlags[];
}

// ─── Helpers ───────────────────────────────────────────────────────

function getDisplayName(msg: MessageWithFlags, filesDict: Record<number, any>): string {
  const toolMsg = msg as any;
  const args = toolMsg.function?.arguments;
  let parsed: any = {};
  try {
    parsed = typeof args === 'string' ? JSON.parse(args) : args || {};
  } catch { /* ignore */ }

  // 1. Look up file name from Redux by ID
  const fileId = parsed.fileId || parsed.fileIds?.[0];
  if (fileId && filesDict[fileId]) {
    return filesDict[fileId].name || `#${fileId}`;
  }

  // 2. Check tool args for name
  if (parsed.name) return parsed.name;

  // 3. Check tool response content for file name
  try {
    const content = typeof toolMsg.content === 'string' ? JSON.parse(toolMsg.content) : toolMsg.content;
    const stateName = content?.state?.fileState?.name;
    if (stateName) return stateName;
  } catch { /* ignore */ }

  // 4. Fallback
  return parsed.file_type || (fileId ? `#${fileId}` : getToolName(msg));
}

/** Parse agent content (TalkToUser) into thinking + content sections */
function parseAgentContent(msg: MessageWithFlags): { thinking: string | null; content: string } {
  const toolMsg = msg as any;
  let raw = toolMsg.content || '';
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed?.content_blocks && Array.isArray(parsed.content_blocks)) {
      const thinkingParts: string[] = [];
      const textParts: string[] = [];
      for (const block of parsed.content_blocks) {
        if (block.type === 'thinking' && block.thinking) thinkingParts.push(block.thinking);
        else if (block.type === 'text' && block.text) textParts.push(block.text);
      }
      return {
        thinking: thinkingParts.length > 0 ? thinkingParts.join('\n\n') : null,
        content: textParts.join('\n\n'),
      };
    }
    if (typeof parsed === 'string') raw = parsed;
    else if (parsed?.content) raw = parsed.content;
    else if (parsed?.message) raw = parsed.message;
  } catch { /* use raw */ }

  // Check for legacy <thinking> tags
  const thinkingMatch = raw.match(/<thinking>([\s\S]*?)<\/thinking>/);
  const thinking = thinkingMatch ? thinkingMatch[1].trim() : null;
  const content = raw.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();

  return { thinking, content };
}

/** Parse file tool content (CreateFile/EditFile/ReadFiles) to extract question content + query result */
function parseFileToolContent(msg: MessageWithFlags): {
  content: import('@/lib/types').QuestionContent | null;
  queryResult: QueryResult | null;
  fileName: string | null;
  filePath: string | null;
  fileType: string | null;
  assetCount: number | null; // for dashboards
} {
  const toolMsg = msg as any;
  const empty = { content: null, queryResult: null, fileName: null, filePath: null, fileType: null, assetCount: null };
  try {
    const parsed = typeof toolMsg.content === 'string' ? JSON.parse(toolMsg.content) : toolMsg.content;
    // Handle CreateFile (state.fileState), EditFile (fileState), ReadFiles (files[0].fileState)
    const fileState = parsed?.state?.fileState || parsed?.fileState || parsed?.files?.[0]?.fileState;
    const queryResults = parsed?.state?.queryResults || parsed?.queryResults || parsed?.files?.[0]?.queryResults;

    if (!fileState) return empty;

    const fileName = fileState.name || null;
    const filePath = fileState.path || null;
    const fileType = fileState.type || null;
    const assetCount = fileState.content?.assets?.filter((a: any) => a.type === 'question')?.length ?? null;

    if (!fileState.content || fileState.type !== 'question') {
      return { content: null, queryResult: null, fileName, filePath, fileType, assetCount };
    }

    const content = fileState.content;
    let queryResult: QueryResult | null = null;

    if (queryResults?.[0]) {
      const qr = queryResults[0];

      // Option 1: rows already parsed as array
      if (qr.rows && Array.isArray(qr.rows) && qr.rows.length > 0) {
        queryResult = { columns: qr.columns, types: qr.types, rows: qr.rows };
      }
      // Option 2: data is markdown table string — parse into Record<string, any>[]
      else if (qr.data && typeof qr.data === 'string') {
        const columns: string[] = qr.columns;
        const lines = qr.data.split('\n').filter((l: string) => l.trim().startsWith('|') && !l.includes('---'));
        // First line is header, rest are data
        const dataLines = lines.slice(1);
        const rows = dataLines
          .filter((line: string) => line.trim().length > 0)
          .map((line: string) => {
            const cells = line.split('|').slice(1, -1).map((cell: string) => {
              const trimmed = cell.trim();
              if (trimmed === '' || trimmed === '-') return null;
              const num = Number(trimmed);
              return isNaN(num) ? trimmed : num;
            });
            // Build a Record<string, any> using column names as keys
            const row: Record<string, any> = {};
            columns.forEach((col, i) => { row[col] = cells[i] ?? null; });
            return row;
          });
        if (rows.length > 0) {
          queryResult = { columns: qr.columns, types: qr.types, rows };
        }
      }
    }

    return { content, queryResult, fileName, filePath, fileType, assetCount };
  } catch {
    return empty;
  }
}

// ─── Build timeline from messages ──────────────────────────────────

function buildTimeline(
  agentMessages: MessageWithFlags[],
): { timeline: TimelineNode[]; lastChatMessage: MessageWithFlags | null } {
  const nodes: TimelineNode[] = [];
  const allChat: MessageWithFlags[] = [];

  for (const msg of agentMessages) {
    if (msg.role !== 'tool') continue; // skip debug

    const toolName = getToolName(msg);

    if (CHAT_TOOLS.has(toolName)) {
      allChat.push(msg);
      const last = nodes[nodes.length - 1];
      if (last && last.type === 'agent') {
        last.messages.push(msg);
        last.count++;
      } else {
        nodes.push({ type: 'agent', icon: LuBrain, label: 'agent', verb: 'Thinking', count: 1, messages: [msg] });
      }
    } else if (toolName === ToolNames.EXECUTE_QUERY) {
      const last = nodes[nodes.length - 1];
      if (last && last.type === 'query') {
        last.messages.push(msg);
        last.count++;
      } else {
        nodes.push({ type: 'query', icon: LuDatabase, label: 'query', verb: 'Querying', count: 1, messages: [msg] });
      }
    } else {
      const config = getToolConfig(toolName);
      const key = config.chipLabel;
      const last = nodes[nodes.length - 1];
      if (last && last.type === 'tool' && last.label === key) {
        last.messages.push(msg);
        last.count++;
      } else {
        nodes.push({ type: 'tool', icon: config.chipIcon, label: key, verb: config.timelineVerb, count: 1, messages: [msg] });
      }
    }
  }

  // Last chat message renders outside the working area — remove it from the timeline node
  const lastChatMessage = allChat.length > 0 ? allChat[allChat.length - 1] : null;

  if (lastChatMessage) {
    // Find the agent node that contains the last chat message and remove it
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (node.type === 'agent') {
        const msgIdx = node.messages.indexOf(lastChatMessage);
        if (msgIdx !== -1) {
          node.messages.splice(msgIdx, 1);
          node.count--;
          // If node is now empty, remove it
          if (node.messages.length === 0) {
            nodes.splice(i, 1);
          }
          break;
        }
      }
    }
  }

  return { timeline: nodes, lastChatMessage };
}

// ─── Component ─────────────────────────────────────────────────────

export default function AgentTurnContainer({
  turn,
  isCompact,
  databaseName,
  showThinking,
  toggleShowThinking,
  markdownContext,
  readOnly,
  conversationID,
  viewMode,
}: AgentTurnContainerProps) {
  const sharedProps = {
    databaseName,
    isCompact,
    showThinking,
    toggleShowThinking,
    markdownContext,
    readOnly,
    conversationID,
    viewMode,
  } as const;

  const filesDict = useAppSelector(state => state.files.files);

  const { timeline, lastChatMessage } = useMemo(
    () => buildTimeline(turn.agentMessages),
    [turn.agentMessages],
  );

  // Default: most recent non-agent node. User can click to override.
  const mostRecentWorkIdx = useMemo(() => {
    for (let i = timeline.length - 1; i >= 0; i--) {
      if (timeline[i].type !== 'agent') return i;
    }
    return 0;
  }, [timeline]);
  const [userSelectedIdx, setUserSelectedIdx] = useState<number | null>(null);
  // If user hasn't clicked anything, show the most recent work node
  const selectedIdx = userSelectedIdx ?? mostRecentWorkIdx;
  const setSelectedIdx = setUserSelectedIdx;

  // Only show the workarea if there's actual work beyond just agent thinking
  const hasWorkNodes = timeline.some(n => n.type !== 'agent');
  const hasTimeline = timeline.length > 0 && hasWorkNodes;

  // ── Right pane renderers ──

  const renderAgentDetail = (node: TimelineNode) => {
    const lastMsg = node.messages[node.messages.length - 1];
    const { thinking, content } = parseAgentContent(lastMsg);

    return (
      <VStack gap={2} align="stretch" p={3} maxH="350px" overflowY="auto">
        {thinking && (
          <Box>
            <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="600" textTransform="uppercase" mb={1}>
              Thinking
            </Text>
            <Box
              bg="bg.elevated"
              borderRadius="md"
              p={3}
            >
              <Text fontSize="xs" fontFamily="mono" color="fg.muted" fontStyle="italic" whiteSpace="pre-wrap">
                {thinking}
              </Text>
            </Box>
          </Box>
        )}
        {content && (
          <Box fontSize="sm">
            <Markdown context={markdownContext}>{content}</Markdown>
          </Box>
        )}
      </VStack>
    );
  };

  const renderQueryDetail = (node: TimelineNode) => {
    return (
      <ChartCarousel
        executeMessages={node.messages}
        databaseName={databaseName}
        isCompact={isCompact}
        showThinking={showThinking}
        toggleShowThinking={toggleShowThinking}
        markdownContext={markdownContext}
        readOnly={readOnly}
      />
    );
  };

  // ─── Tool name → detail card mapping ──

  const DETAIL_CARD_BY_TOOL: Record<string, React.ComponentType<DetailCardProps>> = {
    'Navigate': NavigateDetailCard,
    'PublishAll': PublishAllDetailCard,
    'LoadSkill': LoadSkillDetailCard,
    'EditFile': EditFileDetailCard,
    'ReadFiles': ReadFilesDetailCard,
    'CreateFile': FileDetailCard,
    'SearchFiles': SearchFilesDetailCard,
    'SearchDBSchema': SearchDBSchemaDetailCard,
  };

  const FILE_LABELS = new Set(['created', 'edited', 'read']);

  const renderToolDetail = (node: TimelineNode) => {
    // File-mutating tools: check for chart items first (questions with query results)
    if (FILE_LABELS.has(node.label)) {
      const chartItems: (import('./tools/ChartCarousel').ChartItem | import('./tools/ChartCarousel').ChartErrorItem)[] = [];
      for (const m of node.messages) {
        const parsed = parseFileToolContent(m);
        const name = parsed.fileName || getDisplayName(m, filesDict);
        if (parsed.content && parsed.queryResult) {
          chartItems.push({ name, question: parsed.content, queryResult: parsed.queryResult });
        }
      }
      if (chartItems.length > 0) {
        return <ChartCarousel items={chartItems} databaseName={databaseName} label={node.label} headerIcon={node.icon} />;
      }
    }

    // Everything else: look up detail card by tool name, fallback to FileDetailCard
    return (
      <DetailCarousel icon={node.icon} label={node.label} itemCount={node.messages.length}
        renderCard={(idx) => {
          const msg = node.messages[idx];
          const Card = DETAIL_CARD_BY_TOOL[getToolNameFromMsg(msg)] || FileDetailCard;
          return <Card msg={msg} filesDict={filesDict} />;
        }}
      />
    );
  };

  const renderRightPane = (node: TimelineNode) => {
    switch (node.type) {
      case 'agent': return renderAgentDetail(node);
      case 'query': return renderQueryDetail(node);
      case 'tool': return renderToolDetail(node);
    }
  };

  // Clamp selection
  const safeIdx = Math.min(selectedIdx, timeline.length - 1);
  const selectedNode = timeline[safeIdx];

  return (
    <>
      {/* User message */}
      {turn.userMessage && (
        <SimpleChatMessage
          message={turn.userMessage}
          {...sharedProps}
        />
      )}

      {/* Working area: timeline + detail pane — wider than text for charts */}
      {hasTimeline && !isCompact && (
        <Box
          my={2}
          border="1px solid"
          borderColor="border.default"
          borderRadius="md"
          overflow="hidden"
        >
          <HStack gap={0} align="stretch">
            {/* Timeline rail */}
            <VStack
              flexShrink={0}
              bg="bg.elevated"
              borderRight="1px solid"
              borderColor="border.default"
              py={1}
              gap={0}
              w="150px"
              minW="150px"
            >
              {timeline.map((node, idx) => {
                const isSelected = idx === safeIdx;
                const isFirst = idx === 0;
                const isLast = idx === timeline.length - 1;
                // Dot center: pl=3 (12px) + half dot width (4px) = 16px
                const lineLeft = '15.5px';

                return (
                  <Box
                    key={idx}
                    as="button"
                    aria-label={`${node.verb}${node.count > 1 ? ` ×${node.count}` : ''}`}
                    onClick={() => setSelectedIdx(idx)}
                    display="flex"
                    alignItems="center"
                    gap={2}
                    py={1.5}
                    pl={3}
                    pr={3}
                    w="100%"
                    cursor="pointer"
                    bg={isSelected ? 'accent.teal/12' : 'transparent'}
                    _hover={{ bg: isSelected ? 'accent.teal/12' : 'bg.muted' }}
                    transition="all 0.1s"
                    position="relative"
                  >
                    {/* Vertical timeline line — through dot center */}
                    {!isFirst && (
                      <Box
                        position="absolute"
                        left={lineLeft}
                        top={0}
                        h="50%"
                        w="1.5px"
                        bg="border.default"
                      />
                    )}
                    {!isLast && (
                      <Box
                        position="absolute"
                        left={lineLeft}
                        top="50%"
                        h="50%"
                        w="1.5px"
                        bg="border.default"
                      />
                    )}

                    {/* Timeline dot */}
                    <Box
                      w="8px"
                      h="8px"
                      borderRadius="full"
                      bg={isSelected ? 'accent.teal' : 'bg.elevated'}
                      border="1.5px solid"
                      borderColor={isSelected ? 'accent.teal' : 'fg.subtle'}
                      flexShrink={0}
                      zIndex={1}
                    />

                    {/* Icon */}
                    <Icon
                      as={node.icon}
                      boxSize={3}
                      color={isSelected ? 'accent.teal' : 'fg.muted'}
                      flexShrink={0}
                    />

                    {/* Verb label */}
                    <Text
                      fontSize="xs"
                      fontFamily="mono"
                      color={isSelected ? 'accent.teal' : 'fg.subtle'}
                      fontWeight={isSelected ? '600' : '400'}
                      whiteSpace="nowrap"
                    >
                      {node.verb}
                    </Text>

                    {/* Count badge */}
                    {node.count > 1 && (
                      <Box
                        bg={isSelected ? 'accent.teal/20' : 'bg.muted'}
                        color={isSelected ? 'accent.teal' : 'fg.subtle'}
                        borderRadius="full"
                        px={1.5}
                        py={0}
                        fontSize="2xs"
                        fontFamily="mono"
                        fontWeight="600"
                        lineHeight="1.6"
                        flexShrink={0}
                      >
                        {node.count}
                      </Box>
                    )}
                  </Box>
                );
              })}
            </VStack>

            {/* Right pane */}
            <Box flex={1} minW={0} bg="bg.canvas">
              {selectedNode && renderRightPane(selectedNode)}
            </Box>
          </HStack>
        </Box>
      )}

      {/* Sidebar: chips only */}
      {hasTimeline && isCompact && (
        <Box my={1}>
          <ToolChips
            toolMessages={timeline.flatMap(n => n.messages)}
            readOnly={readOnly}
            showThinking={showThinking}
          />
        </Box>
      )}

      {/* Final chat message — AI's last reply, below the working area */}
      {lastChatMessage && (
        <SimpleChatMessage
          message={lastChatMessage}
          {...sharedProps}
        />
      )}
    </>
  );
}
