'use client';

import React, { useMemo, useState } from 'react';
import { Box, HStack, VStack, Text, Icon, Grid } from '@chakra-ui/react';
import { LuCheck, LuX, LuBrain, LuDatabase, LuChevronLeft, LuChevronRight, LuFile, LuFolder, LuFilePlus2, LuArrowRight, LuUpload, LuBookOpen } from 'react-icons/lu';
import type { Turn } from './message/groupIntoTurns';
import type { MessageWithFlags } from './message/messageHelpers';
import SimpleChatMessage from './SimpleChatMessage';
import ToolChips from './tools/ToolChips';
import ChartCarousel from './tools/ChartCarousel';
import { getToolTier, getToolConfig } from '@/lib/api/tool-config';
import Link from 'next/link';
import { ToolNames, CompletedToolCall } from '@/lib/types';
import { immutableSet } from '@/lib/utils/immutable-collections';
import { useAppSelector } from '@/store/hooks';
import Markdown from '../Markdown';
import type { QueryResult } from '@/lib/types';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import type { FileType } from '@/lib/ui/file-metadata';

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

function isSuccess(msg: MessageWithFlags): boolean {
  const toolMsg = msg as any;
  const content = toolMsg.content;
  if (!content || content === '(executing...)') return true;
  try {
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    return parsed.success !== false;
  } catch {
    return true;
  }
}

function toToolCallTuple(msg: MessageWithFlags): CompletedToolCall {
  const toolMsg = msg as any;
  let functionArgs: Record<string, any>;
  if (typeof toolMsg.function.arguments === 'string') {
    try { functionArgs = JSON.parse(toolMsg.function.arguments); } catch { functionArgs = {}; }
  } else {
    functionArgs = toolMsg.function.arguments || {};
  }
  return [{
    id: toolMsg.tool_call_id,
    type: 'function',
    function: { name: toolMsg.function.name, arguments: functionArgs },
  }, {
    role: 'tool',
    tool_call_id: toolMsg.tool_call_id,
    content: toolMsg.content,
    ...(toolMsg.details && { details: toolMsg.details }),
  }];
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
  const [toolCardIdx, setToolCardIdx] = useState(0);
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

  const renderToolDetail = (node: TimelineNode) => {
    // For file-mutating tools (created/edited/read): show charts for questions, rich cards for others
    if (node.label === 'created' || node.label === 'edited' || node.label === 'read') {
      const chartItems: (import('./tools/ChartCarousel').ChartItem | import('./tools/ChartCarousel').ChartErrorItem)[] = [];
      const nonChartItems: { name: string; path: string | null; fileType: string | null; assetCount: number | null }[] = [];

      for (const m of node.messages) {
        const parsed = parseFileToolContent(m);
        const name = parsed.fileName || getDisplayName(m, filesDict);
        if (parsed.content && parsed.queryResult) {
          chartItems.push({ name, question: parsed.content, queryResult: parsed.queryResult });
        } else {
          nonChartItems.push({ name, path: parsed.filePath, fileType: parsed.fileType, assetCount: parsed.assetCount });
        }
      }

      // If we have any charts, show carousel
      if (chartItems.length > 0) {
        return (
          <ChartCarousel
            items={chartItems}
            databaseName={databaseName}
            label={node.label}
            headerIcon={node.icon}
          />
        );
      }
      // Fall through to default cards for non-question files
    }

    // Search (files + schema): show query + results
    if (node.label === 'searched') {
      const searches = node.messages.map(m => {
        const toolMsg = m as any;
        const toolName = getToolName(m);
        let args: any = {};
        let result: any = {};
        try {
          args = typeof toolMsg.function?.arguments === 'string'
            ? JSON.parse(toolMsg.function.arguments) : toolMsg.function?.arguments || {};
        } catch { /* ignore */ }
        try {
          result = typeof toolMsg.content === 'string' ? JSON.parse(toolMsg.content) : toolMsg.content || {};
        } catch { /* ignore */ }
        const isSchema = toolName === 'SearchDBSchema';
        return {
          kind: isSchema ? 'schema' as const : 'files' as const,
          query: args.query || result.query || '',
          // SearchFiles results
          results: result.results || [],
          total: result.total || 0,
          // SearchDBSchema results
          tables: result.schema || [],
          schemaList: result._schema || [],
        };
      });

      const safeIdx = Math.min(toolCardIdx, searches.length - 1);
      const search = searches[safeIdx];

      return (
        <VStack gap={0} align="stretch">
          {/* Header with nav */}
          <HStack justify="space-between" px={3} pt={2} pb={1}>
            <HStack gap={1.5}>
              <Icon as={node.icon} boxSize={3} color="fg.muted" />
              <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="600" textTransform="uppercase">
                {node.count} {node.count === 1 ? 'search' : 'searches'}
              </Text>
            </HStack>
            {searches.length > 1 && (
              <HStack gap={1.5}>
                <Box as="button" aria-label="Previous"
                  onClick={() => safeIdx > 0 && setToolCardIdx(safeIdx - 1)}
                  w="20px" h="20px" borderRadius="full" bg="accent.teal/15" color="accent.teal"
                  display="flex" alignItems="center" justifyContent="center"
                  cursor={safeIdx === 0 ? 'default' : 'pointer'}
                  opacity={safeIdx === 0 ? 0.3 : 1}
                  _hover={safeIdx === 0 ? {} : { bg: 'accent.teal/25' }}
                >
                  <LuChevronLeft size={12} />
                </Box>
                {searches.map((_, idx) => (
                  <Box key={idx} as="button" aria-label={`Search ${idx + 1}`}
                    w={idx === safeIdx ? '16px' : '6px'} h="6px" borderRadius="full"
                    bg={idx === safeIdx ? 'accent.teal' : 'border.default'}
                    cursor="pointer" transition="all 0.2s" onClick={() => setToolCardIdx(idx)}
                  />
                ))}
                <Box as="button" aria-label="Next"
                  onClick={() => safeIdx < searches.length - 1 && setToolCardIdx(safeIdx + 1)}
                  w="20px" h="20px" borderRadius="full" bg="accent.teal/15" color="accent.teal"
                  display="flex" alignItems="center" justifyContent="center"
                  cursor={safeIdx === searches.length - 1 ? 'default' : 'pointer'}
                  opacity={safeIdx === searches.length - 1 ? 0.3 : 1}
                  _hover={safeIdx === searches.length - 1 ? {} : { bg: 'accent.teal/25' }}
                >
                  <LuChevronRight size={12} />
                </Box>
              </HStack>
            )}
          </HStack>

          {/* Kind label + query */}
          <HStack mx={3} mb={1} gap={2}>
            <Box bg="bg.muted" px={1.5} py={0.5} borderRadius="full" flexShrink={0}>
              <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="500">
                {search.kind === 'schema' ? 'DB Schema' : 'Files'}
              </Text>
            </Box>
            {search.query && (
              <Text fontSize="xs" fontFamily="mono" color="fg.muted" fontStyle="italic" truncate flex={1}>
                &ldquo;{search.query}&rdquo;
              </Text>
            )}
          </HStack>

          {/* Results */}
          <VStack gap={1} align="stretch" px={3} pb={2} maxH="350px" overflowY="auto">
            {search.kind === 'files' ? (
              // File search results
              search.results.length === 0 ? (
                <Text fontSize="xs" color="fg.subtle" fontFamily="mono">No results found</Text>
              ) : (
                <>
                  <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">
                    {search.total} {search.total === 1 ? 'result' : 'results'}
                  </Text>
                  {search.results.map((r: any, idx: number) => {
                    const meta = r.type ? getFileTypeMetadata(r.type as FileType) : null;
                    return (
                      <Box key={r.id || idx} p={2} bg="bg.subtle" borderRadius="md" border="1px solid" borderColor="border.default">
                        <HStack gap={2}>
                          <Icon as={meta?.icon || LuCheck} boxSize={3.5} color={meta?.color || 'fg.muted'} flexShrink={0} />
                          <VStack gap={0} align="start" flex={1} minW={0}>
                            <Text fontSize="xs" fontFamily="mono" color="fg.default" fontWeight="600" truncate w="full">
                              {r.name}
                            </Text>
                            <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" truncate w="full">
                              {r.path}
                            </Text>
                          </VStack>
                          {meta && (
                            <Box bg={`${meta.color}/10`} px={1.5} py={0.5} borderRadius="full" flexShrink={0}>
                              <Text fontSize="2xs" fontFamily="mono" color={meta.color} fontWeight="500">
                                {meta.label}
                              </Text>
                            </Box>
                          )}
                        </HStack>
                      </Box>
                    );
                  })}
                </>
              )
            ) : (
              // DB Schema results — tables with column chips
              search.tables.length > 0 ? (
                <>
                  <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">
                    {search.tables.length} {search.tables.length === 1 ? 'table' : 'tables'}
                  </Text>
                  {search.tables.map((t: any, idx: number) => (
                    <Box key={idx} p={2} bg="bg.subtle" borderRadius="md" border="1px solid" borderColor="border.default">
                      <HStack gap={2} mb={t.columns?.length > 0 ? 1 : 0}>
                        <Icon as={LuDatabase} boxSize={3} color="accent.primary" flexShrink={0} />
                        <Text fontSize="xs" fontFamily="mono" color="fg.default" fontWeight="600">
                          {t._schema ? `${t._schema}.` : ''}{t.table}
                        </Text>
                        {t.columns && (
                          <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">
                            {t.columns.length} cols
                          </Text>
                        )}
                      </HStack>
                      {t.columns && t.columns.length > 0 && (
                        <HStack gap={1} flexWrap="wrap" pl={5}>
                          {t.columns.slice(0, 6).map((col: any, ci: number) => (
                            <Box key={ci} bg="bg.muted" px={1.5} py={0.5} borderRadius="sm">
                              <Text fontSize="2xs" fontFamily="mono" color="fg.muted">
                                {col.name} <Text as="span" color="fg.subtle">{col.type}</Text>
                              </Text>
                            </Box>
                          ))}
                          {t.columns.length > 6 && (
                            <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">+{t.columns.length - 6}</Text>
                          )}
                        </HStack>
                      )}
                    </Box>
                  ))}
                </>
              ) : search.schemaList.length > 0 ? (
                // Schema overview — table name chips
                search.schemaList.map((s: any, idx: number) => (
                  <Box key={idx} p={2} bg="bg.subtle" borderRadius="md" border="1px solid" borderColor="border.default">
                    <HStack gap={2} mb={1}>
                      <Icon as={LuDatabase} boxSize={3} color="accent.primary" />
                      <Text fontSize="xs" fontFamily="mono" color="fg.default" fontWeight="600">{s.schema}</Text>
                      <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">{s.tables?.length || 0} tables</Text>
                    </HStack>
                    {s.tables && (
                      <HStack gap={1} flexWrap="wrap" pl={5}>
                        {s.tables.slice(0, 10).map((t: string, ti: number) => (
                          <Box key={ti} bg="bg.muted" px={1.5} py={0.5} borderRadius="sm">
                            <Text fontSize="2xs" fontFamily="mono" color="fg.muted">{t}</Text>
                          </Box>
                        ))}
                        {s.tables.length > 10 && (
                          <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">+{s.tables.length - 10}</Text>
                        )}
                      </HStack>
                    )}
                  </Box>
                ))
              ) : (
                <Text fontSize="xs" color="fg.subtle" fontFamily="mono">No schema data</Text>
              )
            )}
          </VStack>
        </VStack>
      );
    }

    // Navigate: show navigation target cards with links
    if (node.label === 'navigated') {
      const navItems = node.messages.map(m => {
        const toolMsg = m as any;
        let args: any = {};
        try {
          args = typeof toolMsg.function?.arguments === 'string'
            ? JSON.parse(toolMsg.function.arguments) : toolMsg.function?.arguments || {};
        } catch { /* ignore */ }
        const success = isSuccess(m);
        const { file_id, path, newFileType } = args;

        let icon = LuArrowRight;
        let label = 'Unknown';
        let href: string | null = null;
        if (file_id !== undefined) {
          const file = filesDict[file_id];
          icon = LuFile;
          label = file?.name || `File #${file_id}`;
          href = `/f/${file_id}`;
        } else if (newFileType !== undefined) {
          icon = LuFilePlus2;
          label = `New ${newFileType}`;
          href = null; // Don't link to new file creation pages
        } else if (path !== undefined) {
          icon = LuFolder;
          label = path;
          const cleanPath = path.startsWith('/') ? path.slice(1) : path;
          href = `/p/${cleanPath}`;
        }
        return { icon, label, href, success };
      });

      const safeIdx = Math.min(toolCardIdx, navItems.length - 1);
      const nav = navItems[safeIdx];

      return (
        <VStack gap={0} align="stretch">
          <HStack justify="space-between" px={3} pt={2} pb={1}>
            <HStack gap={1.5}>
              <Icon as={node.icon} boxSize={3} color="fg.muted" />
              <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="600" textTransform="uppercase">
                {node.count} {node.count === 1 ? 'navigation' : 'navigations'}
              </Text>
            </HStack>
            {navItems.length > 1 && (
              <HStack gap={1.5}>
                <Box as="button" aria-label="Previous"
                  onClick={() => safeIdx > 0 && setToolCardIdx(safeIdx - 1)}
                  w="20px" h="20px" borderRadius="full" bg="accent.teal/15" color="accent.teal"
                  display="flex" alignItems="center" justifyContent="center"
                  cursor={safeIdx === 0 ? 'default' : 'pointer'} opacity={safeIdx === 0 ? 0.3 : 1}
                  _hover={safeIdx === 0 ? {} : { bg: 'accent.teal/25' }}
                ><LuChevronLeft size={12} /></Box>
                {navItems.map((_, idx) => (
                  <Box key={idx} as="button" aria-label={`Nav ${idx + 1}`}
                    w={idx === safeIdx ? '16px' : '6px'} h="6px" borderRadius="full"
                    bg={idx === safeIdx ? 'accent.teal' : 'border.default'}
                    cursor="pointer" transition="all 0.2s" onClick={() => setToolCardIdx(idx)}
                  />
                ))}
                <Box as="button" aria-label="Next"
                  onClick={() => safeIdx < navItems.length - 1 && setToolCardIdx(safeIdx + 1)}
                  w="20px" h="20px" borderRadius="full" bg="accent.teal/15" color="accent.teal"
                  display="flex" alignItems="center" justifyContent="center"
                  cursor={safeIdx === navItems.length - 1 ? 'default' : 'pointer'}
                  opacity={safeIdx === navItems.length - 1 ? 0.3 : 1}
                  _hover={safeIdx === navItems.length - 1 ? {} : { bg: 'accent.teal/25' }}
                ><LuChevronRight size={12} /></Box>
              </HStack>
            )}
          </HStack>
          {nav && (
            <Box
              mx={3} mb={2} p={3} bg="bg.subtle" borderRadius="md" border="1px solid" borderColor="border.default"
              {...(nav.href && nav.success ? {
                as: Link, href: nav.href, cursor: 'pointer',
                _hover: { borderColor: 'accent.teal', bg: 'bg.muted' }, transition: 'all 0.15s',
              } : {})}
            >
              <HStack gap={2}>
                <Icon as={nav.success ? nav.icon : LuX} boxSize={4}
                  color={nav.success ? 'fg.muted' : 'accent.danger'} />
                <VStack gap={0} align="start" flex={1} minW={0}>
                  <Text fontSize="sm" fontFamily="mono" color="fg.default" fontWeight="600" truncate w="full">
                    {nav.label}
                  </Text>
                  {nav.href && (
                    <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" truncate w="full">
                      {nav.href}
                    </Text>
                  )}
                </VStack>
                <Box bg="accent.teal/10" px={2} py={0.5} borderRadius="full" flexShrink={0}>
                  <Text fontSize="2xs" fontFamily="mono" color="accent.teal" fontWeight="500">
                    {nav.success ? 'Navigated' : 'Failed'}
                  </Text>
                </Box>
              </HStack>
            </Box>
          )}
        </VStack>
      );
    }

    // PublishAll: show publish status
    if (node.label === 'published') {
      const pubItems = node.messages.map(m => {
        const success = isSuccess(m);
        const toolMsg = m as any;
        let message = '';
        try {
          const parsed = typeof toolMsg.content === 'string' ? JSON.parse(toolMsg.content) : toolMsg.content;
          message = parsed?.message || '';
        } catch { /* ignore */ }
        return { success, message };
      });

      const safeIdx = Math.min(toolCardIdx, pubItems.length - 1);
      const pub = pubItems[safeIdx];

      return (
        <VStack gap={0} align="stretch">
          <HStack justify="space-between" px={3} pt={2} pb={1}>
            <HStack gap={1.5}>
              <Icon as={LuUpload} boxSize={3} color="fg.muted" />
              <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="600" textTransform="uppercase">
                {node.count} {node.count === 1 ? 'publish' : 'publishes'}
              </Text>
            </HStack>
            {pubItems.length > 1 && (
              <HStack gap={1.5}>
                <Box as="button" aria-label="Previous"
                  onClick={() => safeIdx > 0 && setToolCardIdx(safeIdx - 1)}
                  w="20px" h="20px" borderRadius="full" bg="accent.teal/15" color="accent.teal"
                  display="flex" alignItems="center" justifyContent="center"
                  cursor={safeIdx === 0 ? 'default' : 'pointer'} opacity={safeIdx === 0 ? 0.3 : 1}
                  _hover={safeIdx === 0 ? {} : { bg: 'accent.teal/25' }}
                ><LuChevronLeft size={12} /></Box>
                {pubItems.map((_, idx) => (
                  <Box key={idx} as="button" aria-label={`Publish ${idx + 1}`}
                    w={idx === safeIdx ? '16px' : '6px'} h="6px" borderRadius="full"
                    bg={idx === safeIdx ? 'accent.teal' : 'border.default'}
                    cursor="pointer" transition="all 0.2s" onClick={() => setToolCardIdx(idx)}
                  />
                ))}
                <Box as="button" aria-label="Next"
                  onClick={() => safeIdx < pubItems.length - 1 && setToolCardIdx(safeIdx + 1)}
                  w="20px" h="20px" borderRadius="full" bg="accent.teal/15" color="accent.teal"
                  display="flex" alignItems="center" justifyContent="center"
                  cursor={safeIdx === pubItems.length - 1 ? 'default' : 'pointer'}
                  opacity={safeIdx === pubItems.length - 1 ? 0.3 : 1}
                  _hover={safeIdx === pubItems.length - 1 ? {} : { bg: 'accent.teal/25' }}
                ><LuChevronRight size={12} /></Box>
              </HStack>
            )}
          </HStack>
          {pub && (
            <Box mx={3} mb={2} p={3} bg="bg.subtle" borderRadius="md" border="1px solid" borderColor="border.default">
              <HStack gap={2}>
                <Icon as={pub.success ? LuCheck : LuX} boxSize={4}
                  color={pub.success ? 'accent.success' : 'accent.danger'} />
                <VStack gap={0} align="start" flex={1} minW={0}>
                  <Text fontSize="sm" fontFamily="mono" color="fg.default" fontWeight="600">
                    {pub.success ? 'Published successfully' : 'Publish failed'}
                  </Text>
                  {pub.message && (
                    <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" truncate w="full">
                      {pub.message}
                    </Text>
                  )}
                </VStack>
                <Box bg={pub.success ? 'accent.success/10' : 'accent.danger/10'} px={2} py={0.5} borderRadius="full" flexShrink={0}>
                  <Text fontSize="2xs" fontFamily="mono" color={pub.success ? 'accent.success' : 'accent.danger'} fontWeight="500">
                    {pub.success ? 'Done' : 'Error'}
                  </Text>
                </Box>
              </HStack>
            </Box>
          )}
        </VStack>
      );
    }

    // LoadSkill: show skill name cards
    if (node.label === 'loaded skill') {
      const skillItems = node.messages.map(m => {
        const toolMsg = m as any;
        let args: any = {};
        try {
          args = typeof toolMsg.function?.arguments === 'string'
            ? JSON.parse(toolMsg.function.arguments) : toolMsg.function?.arguments || {};
        } catch { /* ignore */ }
        const success = isSuccess(m);
        return { name: args.name || 'unknown', success };
      });

      const safeIdx = Math.min(toolCardIdx, skillItems.length - 1);
      const skill = skillItems[safeIdx];

      return (
        <VStack gap={0} align="stretch">
          <HStack justify="space-between" px={3} pt={2} pb={1}>
            <HStack gap={1.5}>
              <Icon as={LuBookOpen} boxSize={3} color="fg.muted" />
              <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="600" textTransform="uppercase">
                {node.count} {node.count === 1 ? 'skill' : 'skills'}
              </Text>
            </HStack>
            {skillItems.length > 1 && (
              <HStack gap={1.5}>
                <Box as="button" aria-label="Previous"
                  onClick={() => safeIdx > 0 && setToolCardIdx(safeIdx - 1)}
                  w="20px" h="20px" borderRadius="full" bg="accent.teal/15" color="accent.teal"
                  display="flex" alignItems="center" justifyContent="center"
                  cursor={safeIdx === 0 ? 'default' : 'pointer'} opacity={safeIdx === 0 ? 0.3 : 1}
                  _hover={safeIdx === 0 ? {} : { bg: 'accent.teal/25' }}
                ><LuChevronLeft size={12} /></Box>
                {skillItems.map((_, idx) => (
                  <Box key={idx} as="button" aria-label={`Skill ${idx + 1}`}
                    w={idx === safeIdx ? '16px' : '6px'} h="6px" borderRadius="full"
                    bg={idx === safeIdx ? 'accent.teal' : 'border.default'}
                    cursor="pointer" transition="all 0.2s" onClick={() => setToolCardIdx(idx)}
                  />
                ))}
                <Box as="button" aria-label="Next"
                  onClick={() => safeIdx < skillItems.length - 1 && setToolCardIdx(safeIdx + 1)}
                  w="20px" h="20px" borderRadius="full" bg="accent.teal/15" color="accent.teal"
                  display="flex" alignItems="center" justifyContent="center"
                  cursor={safeIdx === skillItems.length - 1 ? 'default' : 'pointer'}
                  opacity={safeIdx === skillItems.length - 1 ? 0.3 : 1}
                  _hover={safeIdx === skillItems.length - 1 ? {} : { bg: 'accent.teal/25' }}
                ><LuChevronRight size={12} /></Box>
              </HStack>
            )}
          </HStack>
          {skill && (
            <Box mx={3} mb={2} p={3} bg="bg.subtle" borderRadius="md" border="1px solid" borderColor="border.default">
              <HStack gap={2}>
                <Icon as={skill.success ? LuBookOpen : LuX} boxSize={4}
                  color={skill.success ? 'fg.muted' : 'accent.danger'} />
                <VStack gap={0} align="start" flex={1} minW={0}>
                  <Text fontSize="sm" fontFamily="mono" color="fg.default" fontWeight="600">
                    {skill.name}
                  </Text>
                  <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">
                    {skill.success ? 'Skill loaded' : 'Failed to load'}
                  </Text>
                </VStack>
                <Box bg={skill.success ? 'accent.teal/10' : 'accent.danger/10'} px={2} py={0.5} borderRadius="full" flexShrink={0}>
                  <Text fontSize="2xs" fontFamily="mono" color={skill.success ? 'accent.teal' : 'accent.danger'} fontWeight="500">
                    {skill.success ? 'Loaded' : 'Error'}
                  </Text>
                </Box>
              </HStack>
            </Box>
          )}
        </VStack>
      );
    }

    // Default: file cards with carousel-style navigation (successful first, failed at end)
    const fileCards = node.messages.map((msg) => {
      const parsed = parseFileToolContent(msg);
      const name = parsed.fileName || getDisplayName(msg, filesDict);
      const success = isSuccess(msg);
      const fileType = parsed.fileType || null;
      const filePath = parsed.filePath || null;
      const assetCount = parsed.assetCount;
      // Get fileId for linking
      let fileId: number | null = null;
      const toolMsg = msg as any;
      try {
        const args = typeof toolMsg.function?.arguments === 'string'
          ? JSON.parse(toolMsg.function.arguments) : toolMsg.function?.arguments || {};
        fileId = args.fileId || args.fileIds?.[0] || null;
      } catch { /* ignore */ }
      if (!fileId) {
        try {
          const content = typeof toolMsg.content === 'string' ? JSON.parse(toolMsg.content) : toolMsg.content;
          fileId = content?.state?.fileState?.id || content?.fileState?.id || null;
        } catch { /* ignore */ }
      }
      const meta = fileType ? getFileTypeMetadata(fileType as FileType) : null;
      const canLink = fileId != null && fileId > 0;
      return { name, success, fileType, filePath, assetCount, meta, fileId, canLink };
    }).sort((a, b) => (a.success === b.success ? 0 : a.success ? -1 : 1));

    const safeCardIdx = Math.min(toolCardIdx, fileCards.length - 1);
    const card = fileCards[safeCardIdx];

    return (
      <VStack gap={0} align="stretch">
        {/* Header with nav */}
        <HStack justify="space-between" px={3} pt={2} pb={1}>
          <HStack gap={1.5}>
            <Icon as={node.icon} boxSize={3} color="fg.muted" />
            <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="600" textTransform="uppercase">
              {node.count} {node.label}
            </Text>
          </HStack>
          {fileCards.length > 1 && (
            <HStack gap={1.5}>
              <Box
                as="button" aria-label="Previous"
                onClick={() => safeCardIdx > 0 && setToolCardIdx(safeCardIdx - 1)}
                w="20px" h="20px" borderRadius="full" bg="accent.teal/15" color="accent.teal"
                display="flex" alignItems="center" justifyContent="center"
                cursor={safeCardIdx === 0 ? 'default' : 'pointer'}
                opacity={safeCardIdx === 0 ? 0.3 : 1}
                _hover={safeCardIdx === 0 ? {} : { bg: 'accent.teal/25' }}
              >
                <LuChevronLeft size={12} />
              </Box>
              {fileCards.map((_, idx) => (
                <Box key={idx} as="button" aria-label={`Item ${idx + 1}`}
                  w={idx === safeCardIdx ? '16px' : '6px'} h="6px" borderRadius="full"
                  bg={idx === safeCardIdx ? 'accent.teal' : 'border.default'}
                  cursor="pointer" transition="all 0.2s" onClick={() => setToolCardIdx(idx)}
                />
              ))}
              <Box
                as="button" aria-label="Next"
                onClick={() => safeCardIdx < fileCards.length - 1 && setToolCardIdx(safeCardIdx + 1)}
                w="20px" h="20px" borderRadius="full" bg="accent.teal/15" color="accent.teal"
                display="flex" alignItems="center" justifyContent="center"
                cursor={safeCardIdx === fileCards.length - 1 ? 'default' : 'pointer'}
                opacity={safeCardIdx === fileCards.length - 1 ? 0.3 : 1}
                _hover={safeCardIdx === fileCards.length - 1 ? {} : { bg: 'accent.teal/25' }}
              >
                <LuChevronRight size={12} />
              </Box>
            </HStack>
          )}
        </HStack>

        {/* File card */}
        {card && (
          <Box
            mx={3} mb={2} p={3} bg="bg.subtle" borderRadius="md" border="1px solid" borderColor="border.default"
            {...(card.canLink ? {
              as: Link,
              href: `/f/${card.fileId}`,
              cursor: 'pointer',
              _hover: { borderColor: 'accent.teal', bg: 'bg.muted' },
              transition: 'all 0.15s',
            } : {})}
          >
            <HStack gap={2}>
              <Icon as={card.meta?.icon || LuCheck} boxSize={4} color={card.meta?.color || (card.success ? 'fg.muted' : 'accent.danger')} />
              <VStack gap={0} align="start" flex={1} minW={0}>
                <Text fontSize="sm" fontFamily="mono" color="fg.default" fontWeight="600" truncate w="full">
                  {card.name || 'Unnamed'}
                </Text>
                {card.filePath && (
                  <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" truncate w="full">
                    {card.filePath}
                  </Text>
                )}
              </VStack>
              {card.meta && (
                <Box bg={`${card.meta.color}/10`} px={2} py={0.5} borderRadius="full" flexShrink={0}>
                  <Text fontSize="2xs" fontFamily="mono" color={card.meta.color} fontWeight="500">
                    {card.meta.label}
                  </Text>
                </Box>
              )}
            </HStack>
            {card.assetCount != null && card.assetCount > 0 && (
              <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" mt={1} pl={6}>
                {card.assetCount} {card.assetCount === 1 ? 'question' : 'questions'}
              </Text>
            )}
          </Box>
        )}
      </VStack>
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
