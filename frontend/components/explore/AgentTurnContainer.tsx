'use client';

import { memo, useCallback, useMemo, useState } from 'react';
import { Box, HStack } from '@chakra-ui/react';
import type { Turn } from './message/groupIntoTurns';
import SimpleChatMessage from './SimpleChatMessage';
import AgentTurnDetailPane from './AgentTurnDetailPane';
import CompactTimelineBar from './CompactTimelineBar';
import VerticalTimelineRail from './VerticalTimelineRail';
import TimelineNavFooter from './TimelineNavFooter';
import { buildTimeline, parseFileToolContent, FILE_LABELS } from './agentTurnTimeline';
import { useAppSelector } from '@/store/hooks';
import { shallowEqual } from 'react-redux';

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
  isLastTurn?: boolean;
}

// ─── Component ─────────────────────────────────────────────────────

function AgentTurnContainerImpl({
  turn,
  isCompact,
  databaseName,
  showThinking,
  toggleShowThinking,
  markdownContext,
  readOnly,
  conversationID,
  viewMode,
  isLastTurn,
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

  // shallowEqual: state.files.files is a Record<id, File> bag — Immer reissues
  // the top-level ref on every file mutation, even unrelated ones. Without a
  // shallow compare, this re-renders the entire agent-turn tree on every
  // file/dashboard write coming from elsewhere in the app. Comparing entries
  // key-by-key (N ref comparisons) is far cheaper than the avoided fan-out.
  const filesDict = useAppSelector(state => state.files.files, shallowEqual);

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

  // Clamp selection
  const safeIdx = Math.min(selectedIdx, timeline.length - 1);
  const selectedNode = timeline[safeIdx];

  // Stable min height for right pane — based on ALL timeline contents, not just selected
  const hasChartContent = useMemo(() =>
    timeline.some(n => n.type === 'query' || (
      FILE_LABELS.has(n.label) && n.messages.some(m => {
        const parsed = parseFileToolContent(m);
        return parsed.fileType === 'question' && parsed.queryResult;
      })
    )),
    [timeline],
  );
  const hasMultipleCharts = useMemo(() =>
    timeline.some(n => (n.type === 'query' && n.messages.length > 1) || (
      FILE_LABELS.has(n.label) && n.messages.filter(m => {
        const parsed = parseFileToolContent(m);
        return parsed.fileType === 'question' && parsed.queryResult;
      }).length > 1
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
  const rightPaneH = hasPendingClarify ? '400px' : hasMultipleCharts ? '450px' : hasChartContent ? '400px' : 'auto';

  // Scroll active horizontal timeline chip into view

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
            <CompactTimelineBar
              timeline={timeline}
              safeIdx={safeIdx}
              setSelectedIdx={setSelectedIdx}
              activeChipRef={activeChipRef}
            />
          ) : (
            <HStack gap={0} align="stretch">
              {/* Timeline rail */}
              <VerticalTimelineRail
                timeline={timeline}
                safeIdx={safeIdx}
                setSelectedIdx={setSelectedIdx}
                rightPaneH={rightPaneH}
              />

              {/* Right pane */}
              <Box flex={1} minW={0} h={rightPaneH} overflowY="auto" bg="bg.canvas">
                {selectedNode && (
                  <AgentTurnDetailPane
                    node={selectedNode}
                    databaseName={databaseName}
                    isCompact={isCompact}
                    showThinking={showThinking}
                    toggleShowThinking={toggleShowThinking}
                    markdownContext={markdownContext}
                    readOnly={readOnly}
                    filesDict={filesDict}
                  />
                )}
              </Box>
            </HStack>
          )}

          {/* Detail pane (compact only — full layout has it inside the HStack) */}
          {isCompact && (
            <Box minW={0} overflowY="auto" bg="bg.canvas">
              {selectedNode && (
                <AgentTurnDetailPane
                  node={selectedNode}
                  databaseName={databaseName}
                  isCompact={isCompact}
                  showThinking={showThinking}
                  toggleShowThinking={toggleShowThinking}
                  markdownContext={markdownContext}
                  readOnly={readOnly}
                  filesDict={filesDict}
                />
              )}
            </Box>
          )}

          {/* Bottom prev/next nav — shared across both layouts */}
          {timeline.length > 1 && (
            <TimelineNavFooter safeIdx={safeIdx} timeline={timeline} setSelectedIdx={setSelectedIdx} />
          )}
        </Box>
      )}

      {/* Final chat message — AI's last reply, below the working area */}
      {lastChatMessage && (
        <SimpleChatMessage
          message={lastChatMessage}
          {...sharedProps}
          userMessageLogIndex={(turn.userMessage as any)?.logIndex}
          isLastAssistantMessage={isLastTurn}
        />
      )}
    </>
  );
}

// memo with default referential equality: once ChatInterface passes stable
// props (`toggleShowThinking` is useCallback'd, sharedProps' primitives are
// stable, and `turn` comes from a stable groupIntoTurns memoization), this
// subtree no longer re-renders when an unrelated streaming chunk lands on
// the parent. Trace 3 attributed 14 ChatInterface re-renders during streaming;
// without this, each one cascaded into a fresh render of every turn.
const AgentTurnContainer = memo(AgentTurnContainerImpl);
export default AgentTurnContainer;
