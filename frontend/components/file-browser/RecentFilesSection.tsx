'use client';

import { useEffect, useState } from 'react';
import { HStack, Text, VStack, Icon } from '@chakra-ui/react';
import { LuSendHorizontal } from 'react-icons/lu';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectHomePage, setSidebarPendingMessage, setActiveSidebarSection, setRightSidebarCollapsed } from '@/store/uiSlice';
import { useClearChat } from '../explore/slash-commands';
import { useConfigs } from '@/lib/hooks/useConfigs';
import type { RecentFile } from '@/lib/analytics/file-analytics.types';
import { useFetch } from '@/lib/http/useFetch';
import { API } from '@/lib/http/declarations';
import type { ConversationSummary } from '@/app/api/conversations/route';
import { SectionHeader, SectionEmptyState, ListSkeleton, CompactFileLink, RelativeTime, CompactConversationLink } from './FeedListItems';
import { QuestionCarousel, CarouselSkeleton } from './QuestionCarouselSection';
import { FeedDataProvider, FeedSummaryInner } from './FeedSummaryPanel';

export interface HomeAnalyticsData {
  recent: RecentFile[];
  trending: RecentFile[];
}

// ─── Exported section components ─────────────────────────────────────

/** AI-generated summary section */
export function FeedSummary() {
  const { config } = useConfigs();
  const { showFeedSummary } = useAppSelector(selectHomePage);

  if (!showFeedSummary) return null;

  return (
    <FeedDataProvider>
      <FeedSummaryInner agentName={config.branding.agentName} />
    </FeedDataProvider>
  );
}

/** Recent questions carousel section */
export function RecentQuestions() {
  const { showRecentQuestions } = useAppSelector(selectHomePage);
  const [data, setData] = useState<HomeAnalyticsData | null>(null);

  useEffect(() => {
    if (!showRecentQuestions) return;
    fetch('/api/analytics/recent-files')
      .then(res => res.json())
      .then(json => {
        if (json.success) setData(json.data);
      })
      .catch(() => {});
  }, [showRecentQuestions]);

  if (!showRecentQuestions) return null;

  const recentQuestions = data?.recent.filter(f => f.fileType === 'question') ?? [];

  // Data loaded but no questions — render nothing so folder view can take over
  if (data && recentQuestions.length === 0) return null;

  return (
    <VStack gap={3} align="stretch">
      <SectionHeader label="Recently viewed" />
      {recentQuestions.length > 0 ? (
        <QuestionCarousel questions={recentQuestions} />
      ) : (
        <CarouselSkeleton />
      )}
    </VStack>
  );
}

/** Recent dashboards list section */
export function RecentDashboards() {
  const { showRecentDashboards } = useAppSelector(selectHomePage);
  const [data, setData] = useState<HomeAnalyticsData | null>(null);

  useEffect(() => {
    if (!showRecentDashboards) return;
    fetch('/api/analytics/recent-files')
      .then(res => res.json())
      .then(json => {
        if (json.success) setData(json.data);
      })
      .catch(() => {});
  }, [showRecentDashboards]);

  if (!showRecentDashboards) return null;

  const recentDashboards = data?.recent.filter(f => f.fileType === 'dashboard') ?? [];

  // Data loaded but no dashboards — render nothing so folder view can take over
  if (data && recentDashboards.length === 0) return null;

  return (
    <VStack gap={3} align="stretch">
      <SectionHeader label="Recent dashboards" />
      {recentDashboards.length > 0 ? (
        <VStack gap={1.5} align="stretch">
          {recentDashboards.map(file => (
            <CompactFileLink key={file.fileId} file={file} meta={<RelativeTime iso={file.lastVisited} />} />
          ))}
        </VStack>
      ) : (
        <ListSkeleton count={2} />
      )}
    </VStack>
  );
}

/** Recent stories list section */
export function RecentStories() {
  const { showRecentStories } = useAppSelector(selectHomePage);
  const [data, setData] = useState<HomeAnalyticsData | null>(null);

  useEffect(() => {
    if (!showRecentStories) return;
    fetch('/api/analytics/recent-files')
      .then(res => res.json())
      .then(json => {
        if (json.success) setData(json.data);
      })
      .catch(() => {});
  }, [showRecentStories]);

  if (!showRecentStories) return null;

  const recentStories = data?.recent.filter(f => f.fileType === 'story') ?? [];

  // Data loaded but no stories — render nothing so folder view can take over
  if (data && recentStories.length === 0) return null;

  return (
    <VStack gap={3} align="stretch">
      <SectionHeader label="Recent stories" />
      {recentStories.length > 0 ? (
        <VStack gap={1.5} align="stretch">
          {recentStories.map(file => (
            <CompactFileLink key={file.fileId} file={file} meta={<RelativeTime iso={file.lastVisited} />} />
          ))}
        </VStack>
      ) : (
        <ListSkeleton count={2} />
      )}
    </VStack>
  );
}

/** Recent conversations list section */
export function RecentConversations() {
  const { showRecentConversations } = useAppSelector(selectHomePage);
  const { data: convData } = useFetch(API.conversations.listRecent);

  if (!showRecentConversations) return null;
  const recentConversations: ConversationSummary[] = (convData as any)?.conversations || [];

  return (
    <VStack gap={3} align="stretch">
      <SectionHeader label="Recent conversations" />
      {recentConversations.length > 0 ? (
        <VStack gap={1.5} align="stretch">
          {recentConversations.map(conv => (
            <CompactConversationLink key={conv.id} conversation={conv} />
          ))}
        </VStack>
      ) : convData ? (
        <SectionEmptyState message="No conversations yet" linkLabel="Start a conversation" linkHref="/explore" />
      ) : (
        <ListSkeleton count={3} />
      )}
    </VStack>
  );
}

const suggestedPrompts = [
  'What all can you do?',
  'Which is our main dashboard?',
  'How do I invite my colleagues?',
];

/** Suggested questions section for the home page */
export function SuggestedQuestions() {
  const dispatch = useAppDispatch();
  const clearChat = useClearChat();
  const { showSuggestedPrompts } = useAppSelector(selectHomePage);

  if (!showSuggestedPrompts) return null;

  const handleClick = (prompt: string) => {
    clearChat();
    dispatch(setSidebarPendingMessage(prompt));
    dispatch(setActiveSidebarSection('chat'));
    dispatch(setRightSidebarCollapsed(false));
  };

  return (
    <VStack gap={3} align="stretch">
      <SectionHeader label="Try These" />
      <VStack gap={1.5} align="stretch">
        {suggestedPrompts.map((prompt, idx) => (
          <HStack
            key={idx}
            gap={2.5}
            py={1.5}
            px={2}
            borderRadius="md"
            cursor="pointer"
            transition="all 0.15s ease"
            _hover={{ bg: 'bg.surface' }}
            onClick={() => handleClick(prompt)}
          >
            <Icon as={LuSendHorizontal} color="accent.teal" boxSize={3} flexShrink={0} />
            <Text flex="1" minW={0} fontSize="xs" fontWeight="500" color="fg.default" truncate fontFamily="mono">
              {prompt}
            </Text>
          </HStack>
        ))}
      </VStack>
    </VStack>
  );
}

// ─── Home folder file browser (shown when analytics are empty) ──────

export { default as HomeFolderFiles } from './HomeFolderFiles';
