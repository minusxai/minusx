'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { Box, HStack, VStack, Text, Icon } from '@chakra-ui/react';
import { LuBrain, LuDatabase, LuChevronLeft, LuChevronRight } from 'react-icons/lu';
import type { Turn } from './message/groupIntoTurns';
import type { MessageWithFlags } from './message/messageHelpers';
import SimpleChatMessage from './SimpleChatMessage';
import ChartCarousel from './tools/ChartCarousel';
import DetailCarousel, { type DetailCardProps, getToolNameFromMsg, isToolSuccess } from './tools/DetailCarousel';
import { NavigateDetailCard } from './tools/NavigateDisplay';
import { PublishAllDetailCard } from './tools/PublishAllDisplay';
import { LoadSkillDetailCard } from './tools/LoadSkillDisplay';
import { SearchFilesDetailCard } from './tools/SearchFilesDisplay';
import { SearchDBSchemaDetailCard } from './tools/SearchDBSchemaDisplay';
import { FileDetailCard } from './tools/CreateFileDisplay';
import { ClarifyDetailCard } from './tools/ClarifyDisplay';
import { EditFileDetailCard } from './tools/EditFileDisplay';
import { ReadFilesDetailCard } from './tools/ReadFilesDisplay';
import { getToolConfig } from '@/lib/api/tool-config';
import { WebSearchDetailCard, type WebSearchResult } from './tools/WebSearchDisplay';
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
  label: string;          // Singular noun: "file edit", "search", "query"
  labelPlural: string;    // Plural noun: "file edits", "searches", "queries"
  verb: string;           // e.g. "Creating", "Editing", "Executing"
  count: number;
  messages: MessageWithFlags[];
  webSearchResults?: WebSearchResult[];  // Only set for synthetic web search nodes
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
    // content may be a string, an object, or an array of content blocks (text + image)
    let rawContent = toolMsg.content;
    if (Array.isArray(rawContent)) {
      const textBlock = rawContent.find((b: any) => b.type === 'text');
      rawContent = textBlock?.text ?? rawContent;
    }
    const parsed = typeof rawContent === 'string' ? JSON.parse(rawContent) : rawContent;
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

/** Extract web search results from a CHAT_TOOLS message's content_blocks */
function extractWebSearchResults(msg: MessageWithFlags): WebSearchResult[] | null {
  const toolMsg = msg as any;
  const raw = toolMsg.content || '';
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed?.content_blocks || !Array.isArray(parsed.content_blocks)) return null;

    const results: WebSearchResult[] = [];
    for (const block of parsed.content_blocks) {
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const item of block.content) {
          if (item.type === 'web_search_result') {
            results.push({ url: item.url, title: item.title });
          }
        }
      }
    }

    // Enrich with cited_text from top-level citations
    if (parsed.citations && Array.isArray(parsed.citations)) {
      for (const citation of parsed.citations) {
        if (citation.type === 'web_search_result_location' && citation.cited_text) {
          const match = results.find(r => r.url === citation.url);
          if (match) match.cited_text = citation.cited_text;
        }
      }
    }

    return results.length > 0 ? results : null;
  } catch {
    return null;
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
      // Check for web search results embedded in this chat message
      const webResults = extractWebSearchResults(msg);
      if (webResults) {
        const wsConfig = getToolConfig('WebSearch');
        nodes.push({
          type: 'tool', icon: wsConfig.chipIcon, label: wsConfig.chipLabel,
          labelPlural: wsConfig.chipLabelPlural, verb: wsConfig.timelineVerb,
          count: webResults.length, messages: [msg], webSearchResults: webResults,
        });
      }

      allChat.push(msg);
      const last = nodes[nodes.length - 1];
      if (last && last.type === 'agent') {
        last.messages.push(msg);
        last.count++;
      } else {
        nodes.push({ type: 'agent', icon: LuBrain, label: 'thought', labelPlural: 'thoughts', verb: 'Thinking', count: 1, messages: [msg] });
      }
    } else if (toolName === ToolNames.EXECUTE_QUERY) {
      const last = nodes[nodes.length - 1];
      if (last && last.type === 'query') {
        last.messages.push(msg);
        last.count++;
      } else {
        nodes.push({ type: 'query', icon: LuDatabase, label: 'query', labelPlural: 'queries', verb: 'Querying', count: 1, messages: [msg] });
      }
    } else {
      const config = getToolConfig(toolName);
      const key = config.chipLabel;
      const last = nodes[nodes.length - 1];
      if (last && last.type === 'tool' && last.label === key) {
        last.messages.push(msg);
        last.count++;
      } else {
        nodes.push({ type: 'tool', icon: config.chipIcon, label: config.chipLabel, labelPlural: config.chipLabelPlural, verb: config.timelineVerb, count: 1, messages: [msg] });
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
      <Box p={3}>
        <Box
          bg="bg.elevated"
          borderRadius="lg"
          border="1px solid"
          borderColor="border.default"
          p={4}
        >
          {thinking && (
            <Box mb={content ? 3 : 0}>
              <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="600" textTransform="uppercase" mb={1.5}>
                Thinking
              </Text>
              <Text fontSize="xs" fontFamily="mono" color="fg.muted" fontStyle="italic" whiteSpace="pre-wrap">
                {thinking}
              </Text>
            </Box>
          )}
          {content && (
            <Box fontSize="sm">
              <Markdown context={markdownContext}>{content}</Markdown>
            </Box>
          )}
        </Box>
      </Box>
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

  // null = skip this tool in the carousel (e.g. Clarify is redundant with ClarifyFrontend)
  const DETAIL_CARD_BY_TOOL: Record<string, React.ComponentType<DetailCardProps> | null> = {
    'Navigate': NavigateDetailCard,
    'PublishAll': PublishAllDetailCard,
    'LoadSkill': LoadSkillDetailCard,
    'Clarify': ClarifyDetailCard,
    'ClarifyFrontend': ClarifyDetailCard,
    'EditFile': EditFileDetailCard,
    'ReadFiles': ReadFilesDetailCard,
    'CreateFile': FileDetailCard,
    'SearchFiles': SearchFilesDetailCard,
    'SearchDBSchema': SearchDBSchemaDetailCard,
  };

  const FILE_LABELS = new Set(['file create', 'file edit', 'file read']);

  const renderToolDetail = (node: TimelineNode) => {
    // Synthetic web search node — render directly, no carousel
    if (node.webSearchResults) {
      return <WebSearchDetailCard results={node.webSearchResults} icon={node.icon} />;
    }

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
        return <ChartCarousel items={chartItems} databaseName={databaseName} label={node.label} labelPlural={node.labelPlural} headerIcon={node.icon} isCompact={isCompact} />;
      }
    }

    // Filter out skipped tools (explicit null in map), then sort successes first
    const filtered = node.messages.filter(m => {
      const name = getToolNameFromMsg(m);
      return !(name in DETAIL_CARD_BY_TOOL && DETAIL_CARD_BY_TOOL[name] === null);
    });
    const sorted = filtered.sort((a, b) => {
      const aOk = isToolSuccess(a) ? 0 : 1;
      const bOk = isToolSuccess(b) ? 0 : 1;
      return aOk - bOk;
    });
    const errorCount = sorted.filter(m => !isToolSuccess(m)).length;

    // Look up detail card by tool name, fallback to FileDetailCard
    return (
      <DetailCarousel icon={node.icon} label={node.label} labelPlural={node.labelPlural} itemCount={sorted.length} errorCount={errorCount}
        renderCard={(idx) => {
          const msg = sorted[idx];
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

  // Stable min height for right pane — based on ALL timeline contents, not just selected
  const hasChartContent = useMemo(() =>
    timeline.some(n => n.type === 'query' || (
      FILE_LABELS.has(n.label) && n.messages.some(m => {
        const parsed = parseFileToolContent(m);
        return parsed.fileType === 'question';
      })
    )),
    [timeline],
  );
  const hasPendingClarify = useMemo(() =>
    timeline.some(n => n.messages.some(m => {
      const name = (m as any).function?.name || '';
      if (name !== 'ClarifyFrontend' && name !== 'Clarify') return false;
      // Only tall when clarify is still unresolved (no content yet)
      const content = (m as any).content;
      return !content || content === '(executing...)';
    })),
    [timeline],
  );
  const rightPaneH = hasPendingClarify ? '400px' : hasChartContent ? '400px' : 'auto';

  // Scroll active horizontal timeline chip into view
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const activeChipRef = useCallback((el: HTMLElement | null) => {
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [safeIdx]);

  return (
    <>
      {/* User message */}
      {turn.userMessage && (
        <SimpleChatMessage
          message={turn.userMessage}
          {...sharedProps}
        />
      )}

      {/* Working area: timeline + detail pane */}
      {hasTimeline && (
        <Box
          my={2}
          border="1px solid"
          borderColor="border.default"
          borderRadius="md"
          overflow="hidden"
        >
          {/* Timeline — compact (horizontal) or full (vertical rail + detail side-by-side) */}
          {isCompact ? (
            <HStack
              bg="bg.elevated"
              borderBottom="1px solid"
              borderColor="border.default"
              px={1} py={1} gap={1}
            >
              <Text
                fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="600"
                textTransform="uppercase" flexShrink={0} pl={1}
              >
                Tools
              </Text>
              {/* Prev chevron */}
              <Box
                as="button"
                aria-label="Previous step"
                onClick={() => safeIdx > 0 && setSelectedIdx(safeIdx - 1)}
                w="20px" h="20px" borderRadius="full"
                bg="accent.teal/15" color="accent.teal"
                display="flex" alignItems="center" justifyContent="center"
                cursor={safeIdx === 0 ? 'default' : 'pointer'}
                opacity={safeIdx === 0 ? 0.3 : 1}
                _hover={safeIdx === 0 ? {} : { bg: 'accent.teal/25' }}
                flexShrink={0}
              >
                <LuChevronLeft size={12} />
              </Box>

              {/* All steps — scroll horizontally if they overflow */}
              <HStack gap={0} flex={1} minW={0} overflowX="auto" flexWrap="nowrap" css={{ scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
                {timeline.map((node, idx) => {
                  const isSelected = idx === safeIdx;
                  const isLast = idx === timeline.length - 1;

                  return (
                    <React.Fragment key={idx}>
                      <Box
                        ref={isSelected ? activeChipRef : undefined}
                        as="button"
                        aria-label={`${node.verb}${node.count > 1 ? ` ×${node.count}` : ''}`}
                        onClick={() => setSelectedIdx(idx)}
                        display="flex"
                        alignItems="center"
                        gap={1}
                        px={1.5}
                        py={0.5}
                        cursor="pointer"
                        bg={isSelected ? 'accent.teal/12' : 'transparent'}
                        borderRadius="sm"
                        _hover={{ bg: isSelected ? 'accent.teal/12' : 'bg.muted' }}
                        transition="all 0.1s"
                        flexShrink={0}
                      >
                        <Icon
                          as={node.icon}
                          boxSize={3}
                          color={isSelected ? 'accent.teal' : 'fg.muted'}
                          flexShrink={0}
                        />
                        <Text
                          fontSize="2xs"
                          fontFamily="mono"
                          color={isSelected ? 'accent.teal' : 'fg.subtle'}
                          fontWeight={isSelected ? '600' : '400'}
                          whiteSpace="nowrap"
                        >
                          {node.verb}
                        </Text>
                        {node.count > 1 && (
                          <Box
                            bg={isSelected ? 'accent.teal/20' : 'bg.muted'}
                            color={isSelected ? 'accent.teal' : 'fg.subtle'}
                            borderRadius="full"
                            px={1}
                            fontSize="2xs"
                            fontFamily="mono"
                            fontWeight="600"
                            lineHeight="1.4"
                            flexShrink={0}
                          >
                            {node.count}
                          </Box>
                        )}
                      </Box>
                      {!isLast && (
                        <Text color="border.default" fontSize="xs" flexShrink={0} lineHeight={1}>›</Text>
                      )}
                    </React.Fragment>
                  );
                })}
              </HStack>

              {/* Next chevron */}
              <Box
                as="button"
                aria-label="Next step"
                onClick={() => safeIdx < timeline.length - 1 && setSelectedIdx(safeIdx + 1)}
                w="20px" h="20px" borderRadius="full"
                bg="accent.teal/15" color="accent.teal"
                display="flex" alignItems="center" justifyContent="center"
                cursor={safeIdx >= timeline.length - 1 ? 'default' : 'pointer'}
                opacity={safeIdx >= timeline.length - 1 ? 0.3 : 1}
                _hover={safeIdx >= timeline.length - 1 ? {} : { bg: 'accent.teal/25' }}
                flexShrink={0}
              >
                <LuChevronRight size={12} />
              </Box>
            </HStack>
          ) : (
            <HStack gap={0} align="stretch">
              {/* Timeline rail */}
              <VStack
                flexShrink={0}
                bg="bg.elevated"
                borderRight="1px solid"
                borderColor="border.default"
                py={1}
                gap={0}
                w="170px"
                minW="170px"
                maxH="400px"
                overflowY="auto"
              >
                <Text
                  fontSize="2xs" fontFamily="mono" color="fg.subtle" fontWeight="600"
                  textTransform="uppercase" px={3} pt={1} pb={1.5} w="100%"
                >
                  Tools Timeline
                </Text>
                {timeline.map((node, idx) => {
                  const isSelected = idx === safeIdx;
                  const isFirst = idx === 0;
                  const isLast = idx === timeline.length - 1;
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
                      px={3}
                      w="100%"
                      cursor="pointer"
                      bg={isSelected ? 'accent.teal/12' : 'transparent'}
                      _hover={{ bg: isSelected ? 'accent.teal/12' : 'bg.muted' }}
                      transition="all 0.1s"
                      position="relative"
                    >
                      {!isFirst && (
                        <Box position="absolute" left={lineLeft} top={0} h="50%" w="1.5px" bg="border.default" />
                      )}
                      {!isLast && (
                        <Box position="absolute" left={lineLeft} top="50%" h="50%" w="1.5px" bg="border.default" />
                      )}
                      <Box
                        w="8px" h="8px" borderRadius="full"
                        bg={isSelected ? 'accent.teal' : 'bg.elevated'}
                        border="1.5px solid" borderColor={isSelected ? 'accent.teal' : 'fg.subtle'}
                        flexShrink={0} zIndex={1}
                      />
                      <Icon as={node.icon} boxSize={3} color={isSelected ? 'accent.teal' : 'fg.muted'} flexShrink={0} />
                      <Text
                        fontSize="xs" fontFamily="mono"
                        color={isSelected ? 'accent.teal' : 'fg.subtle'}
                        fontWeight={isSelected ? '600' : '400'}
                        whiteSpace="nowrap"
                      >
                        {node.verb}
                      </Text>
                      {node.count > 1 && (
                        <Box
                          bg={isSelected ? 'accent.teal/20' : 'bg.muted'}
                          color={isSelected ? 'accent.teal' : 'fg.subtle'}
                          borderRadius="full" px={1.5} py={0}
                          fontSize="2xs" fontFamily="mono" fontWeight="600" lineHeight="1.6"
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
              <Box flex={1} minW={0} h={rightPaneH} overflowY="auto" bg="bg.canvas">
                {selectedNode && renderRightPane(selectedNode)}
              </Box>
            </HStack>
          )}

          {/* Detail pane (compact only — full layout has it inside the HStack) */}
          {isCompact && (
            <Box minW={0} overflowY="auto" bg="bg.canvas">
              {selectedNode && renderRightPane(selectedNode)}
            </Box>
          )}

          {/* Bottom prev/next nav — shared across both layouts */}
          {timeline.length > 1 && (
            <HStack
              justify="space-between"
              px={3} py={1.5}
              borderTop="1px solid"
              borderColor="border.default"
            >
              <Box
                as="button"
                aria-label="Previous tool"
                onClick={() => safeIdx > 0 && setSelectedIdx(safeIdx - 1)}
                display="flex" alignItems="center" gap={1}
                cursor={safeIdx > 0 ? 'pointer' : 'default'}
                opacity={safeIdx > 0 ? 1 : 0.3}
                _hover={safeIdx > 0 ? { color: 'accent.teal' } : {}}
                transition="all 0.15s"
                color="fg.subtle"
              >
                <LuChevronLeft size={14} />
                <Text fontSize="2xs" fontFamily="mono" fontWeight="500">
                  {safeIdx > 0 ? timeline[safeIdx - 1].verb : 'Prev'}
                </Text>
              </Box>
              <Text fontSize="2xs" fontFamily="mono" color="fg.subtle">
                {safeIdx + 1} / {timeline.length}
              </Text>
              <Box
                as="button"
                aria-label="Next tool"
                onClick={() => safeIdx < timeline.length - 1 && setSelectedIdx(safeIdx + 1)}
                display="flex" alignItems="center" gap={1}
                cursor={safeIdx < timeline.length - 1 ? 'pointer' : 'default'}
                opacity={safeIdx < timeline.length - 1 ? 1 : 0.3}
                _hover={safeIdx < timeline.length - 1 ? { color: 'accent.teal' } : {}}
                transition="all 0.15s"
                color="fg.subtle"
              >
                <Text fontSize="2xs" fontFamily="mono" fontWeight="500">
                  {safeIdx < timeline.length - 1 ? timeline[safeIdx + 1].verb : 'Next'}
                </Text>
                <LuChevronRight size={14} />
              </Box>
            </HStack>
          )}
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
