'use client';

import React from 'react';
import { Box, Text } from '@chakra-ui/react';
import type { MessageWithFlags } from './message/messageHelpers';
import ChartCarousel from './tools/ChartCarousel';
import DetailCarousel, { type DetailCardProps, getToolNameFromMsg, isToolSuccess } from './tools/DetailCarousel';
import { NavigateDetailCard } from './tools/NavigateDisplay';
import { ScreenshotDetailCard } from './tools/ScreenshotDisplay';
import { PublishAllDetailCard } from './tools/PublishAllDisplay';
import { LoadSkillDetailCard } from './tools/LoadSkillDisplay';
import { LoadContextDetailCard } from './tools/LoadContextDisplay';
import { SearchFilesDetailCard } from './tools/SearchFilesDisplay';
import { SearchDBSchemaDetailCard } from './tools/SearchDBSchemaDisplay';
import { ListDBConnectionsDetailCard } from './tools/ListDBConnectionsDisplay';
import { FileDetailCard } from './tools/CreateFileDisplay';
import { ClarifyDetailCard } from './tools/ClarifyDisplay';
import { EditFileDetailCard } from './tools/EditFileDisplay';
import { ReadFilesDetailCard } from './tools/ReadFilesDisplay';
import { FuzzyMatchDetailCard } from './tools/FuzzyMatchDisplay';
import { ExploreDatasetDetailCard } from './tools/ExploreDatasetDisplay';
import { WebSearchDetailCard } from './tools/WebSearchDisplay';
import Markdown from '../Markdown';
import { FILE_LABELS, parseAgentContent, parseFileToolContent, getDisplayName, type TimelineNode } from './agentTurnTimeline';

interface AgentTurnDetailPaneProps {
  node: TimelineNode;
  databaseName: string;
  isCompact: boolean;
  showThinking: boolean;
  toggleShowThinking: () => void;
  markdownContext: 'sidebar' | 'mainpage';
  readOnly: boolean;
  filesDict: Record<number, any>;
}

// null = skip this tool in the carousel (e.g. Clarify is redundant with ClarifyFrontend)
const DETAIL_CARD_BY_TOOL: Record<string, React.ComponentType<DetailCardProps> | null> = {
  'Navigate': NavigateDetailCard,
  'Screenshot': ScreenshotDetailCard,
  'PublishAll': PublishAllDetailCard,
  'LoadSkill': LoadSkillDetailCard,
  'LoadContext': LoadContextDetailCard,
  'Clarify': ClarifyDetailCard,
  'ClarifyFrontend': ClarifyDetailCard,
  'EditFile': EditFileDetailCard,
  'ReadFiles': ReadFilesDetailCard,
  'CreateFile': FileDetailCard,
  'SearchFiles': SearchFilesDetailCard,
  'SearchDBSchema': SearchDBSchemaDetailCard,
  'FuzzyMatch': FuzzyMatchDetailCard,
  'ExploreDataset': ExploreDatasetDetailCard,
  'ListDBConnections': ListDBConnectionsDetailCard,
};

/**
 * Right-pane detail renderer for the selected timeline node — routes to the
 * agent-thought box, the query ChartCarousel, or the per-tool DetailCarousel.
 */
export default function AgentTurnDetailPane({
  node,
  databaseName,
  isCompact,
  showThinking,
  toggleShowThinking,
  markdownContext,
  readOnly,
  filesDict,
}: AgentTurnDetailPaneProps) {
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

    // Filter out skipped tools (explicit null in map) and autogenerated messages (rendered inline)
    const filtered = node.messages.filter(m => {
      if (m.role === 'autogenerated') return false;
      const name = getToolNameFromMsg(m);
      return !(name in DETAIL_CARD_BY_TOOL && DETAIL_CARD_BY_TOOL[name] === null);
    });

    // If all messages were autogenerated, render skill load cards directly
    if (filtered.length === 0) {
      const autoMsgs = node.messages.filter(m => m.role === 'autogenerated');
      return (
        <DetailCarousel icon={node.icon} label={node.label} labelPlural={node.labelPlural} itemCount={autoMsgs.length}
          renderCard={(idx) => {
            const autoMsg = autoMsgs[idx] as any;
            // Wrap as a synthetic msg shape for LoadSkillDetailCard
            const syntheticMsg = {
              role: 'tool',
              tool_call_id: `auto-${idx}`,
              content: JSON.stringify({ success: true }),
              function: { name: 'LoadSkill', arguments: JSON.stringify({ name: autoMsg.content?.name || 'unknown' }) },
              created_at: autoMsg.created_at,
            } as MessageWithFlags;
            return <LoadSkillDetailCard msg={syntheticMsg} filesDict={filesDict} />;
          }}
        />
      );
    }

    const sorted = filtered.sort((a, b) => {
      const aOk = isToolSuccess(a) ? 0 : 1;
      const bOk = isToolSuccess(b) ? 0 : 1;
      return aOk - bOk;
    });
    // Look up detail card by tool name, fallback to FileDetailCard
    return (
      <DetailCarousel icon={node.icon} label={node.label} labelPlural={node.labelPlural} itemCount={sorted.length}
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

  return <>{renderRightPane(node)}</>;
}
