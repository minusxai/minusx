'use client';

import { useEffect, useState, useCallback, createContext, useContext as useReactContext } from 'react';
import { Box, HStack, Text, VStack, Icon, Skeleton } from '@chakra-ui/react';
import Link from 'next/link';
import { LuChevronLeft, LuChevronRight, LuMessageSquare, LuRefreshCw, LuPlus, LuArrowRight, LuSendHorizontal } from 'react-icons/lu';
import { FILE_TYPE_METADATA } from '@/lib/ui/file-metadata';
import { generateFileUrl } from '@/lib/slug-utils';
import SmartEmbeddedQuestionContainer from '@/components/containers/SmartEmbeddedQuestionContainer';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { selectRightSidebarUIState, selectDevMode, selectHomePage, setSidebarPendingMessage, setActiveSidebarSection, setRightSidebarCollapsed } from '@/store/uiSlice';
import { setActiveConversation } from '@/store/chatSlice';
import { readFiles } from '@/lib/api/file-state';
import { compressAugmentedFile } from '@/lib/api/compress-augmented';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { useContext } from '@/lib/hooks/useContext';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import type { RecentFile } from '@/lib/analytics/file-analytics.types';
import Markdown from '@/components/Markdown';
import { useFetch } from '@/lib/api/useFetch';
import { API } from '@/lib/api/declarations';
import { fetchWithCache } from '@/lib/api/fetch-wrapper';
import type { ConversationSummary } from '@/app/api/conversations/route';

interface HomeAnalyticsData {
  recent: RecentFile[];
  trending: RecentFile[];
}

function relativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
  return `${Math.floor(diffDay / 30)}mo ago`;
}

/** Section header with horizontal rule */
function SectionHeader({ label }: { label: string }) {
  return (
    <HStack gap={2}>
      <Box flex="1" h="1px" bg="border.default" />
      <Text fontSize="2xs" fontFamily="mono" fontWeight="600" color="fg.subtle" textTransform="uppercase" letterSpacing="wider" flexShrink={0}>
        {label}
      </Text>
    </HStack>
  );
}

/** Empty state with optional CTA link */
function SectionEmptyState({ message, linkLabel, linkHref }: { message: string; linkLabel?: string; linkHref?: string }) {
  return (
    <VStack gap={2} py={4} align="center">
      <Text fontSize="xs" color="fg.subtle" fontFamily="mono">
        {message}
      </Text>
      {linkLabel && linkHref && (
        <Link href={linkHref}>
          <HStack
            gap={1.5}
            px={3}
            py={1}
            borderRadius="full"
            bg="accent.teal/10"
            cursor="pointer"
            transition="all 0.15s ease"
            _hover={{ bg: 'accent.teal/20' }}
          >
            <Icon as={LuArrowRight} color="accent.teal" boxSize={3} />
            <Text fontSize="2xs" fontWeight="600" fontFamily="mono" color="accent.teal">
              {linkLabel}
            </Text>
          </HStack>
        </Link>
      )}
    </VStack>
  );
}

/** Skeleton for list sections (dashboards, conversations) */
function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <VStack gap={2} align="stretch">
      {Array.from({ length: count }, (_, i) => (
        <HStack key={i} gap={2.5} py={1.5} px={2}>
          <Skeleton height="12px" width="12px" borderRadius="sm" />
          <Skeleton height="10px" flex="1" borderRadius="sm" />
          <Skeleton height="10px" width="40px" borderRadius="sm" />
        </HStack>
      ))}
    </VStack>
  );
}

/** Skeleton for the chart carousel */
function CarouselSkeleton() {
  return (
    <Box borderRadius="lg" bg="bg.surface" overflow="hidden" h="340px" p={4}>
      <Skeleton height="14px" width="60%" borderRadius="sm" mb={4} />
      <Skeleton height="250px" width="100%" borderRadius="md" />
    </Box>
  );
}

/** Live chart card using the same component as DashboardView */
function QuestionChartCard({ file }: { file: RecentFile }) {
  return (
    <Box
      borderRadius="lg"
      bg="bg.surface"
      overflow="hidden"
      h="340px"
      display="flex"
      flexDirection="column"
    >
      <SmartEmbeddedQuestionContainer
        questionId={file.fileId}
        showTitle={true}
      />
    </Box>
  );
}

/** Carousel with nav dots for questions */
function QuestionCarousel({ questions }: { questions: RecentFile[] }) {
  const [activeIdx, setActiveIdx] = useState(0);

  const prev = useCallback(() => setActiveIdx(i => (i - 1 + questions.length) % questions.length), [questions.length]);
  const next = useCallback(() => setActiveIdx(i => (i + 1) % questions.length), [questions.length]);

  if (questions.length === 0) return null;
  if (questions.length === 1) return <QuestionChartCard file={questions[0]} />;

  const canPrev = activeIdx > 0;
  const canNext = activeIdx < questions.length - 1;

  return (
    <Box>
      <QuestionChartCard file={questions[activeIdx]} />
      <HStack justify="center" gap={1.5} mt={2}>
        <Box
          as="button"
          aria-label="Previous question"
          onClick={prev}
          w="24px"
          h="24px"
          borderRadius="full"
          bg={canPrev ? 'accent.teal' : 'accent.teal/15'}
          color={canPrev ? 'white' : 'accent.teal'}
          display="flex"
          alignItems="center"
          justifyContent="center"
          cursor={canPrev ? 'pointer' : 'default'}
          opacity={canPrev ? 1 : 0.4}
          _hover={canPrev ? { boxShadow: 'sm' } : {}}
          transition="all 0.15s"
        >
          <LuChevronLeft size={14} />
        </Box>
        {questions.map((_, idx) => (
          <Box
            key={idx}
            as="button"
            aria-label={`Question ${idx + 1}`}
            w={idx === activeIdx ? '16px' : '6px'}
            h="6px"
            borderRadius="full"
            bg={idx === activeIdx ? 'accent.teal' : 'border.default'}
            cursor="pointer"
            transition="all 0.2s"
            onClick={() => setActiveIdx(idx)}
          />
        ))}
        <Box
          as="button"
          aria-label="Next question"
          onClick={next}
          w="24px"
          h="24px"
          borderRadius="full"
          bg={canNext ? 'accent.teal' : 'accent.teal/15'}
          color={canNext ? 'white' : 'accent.teal'}
          display="flex"
          alignItems="center"
          justifyContent="center"
          cursor={canNext ? 'pointer' : 'default'}
          opacity={canNext ? 1 : 0.4}
          _hover={canNext ? { boxShadow: 'sm' } : {}}
          transition="all 0.15s"
        >
          <LuChevronRight size={14} />
        </Box>
      </HStack>
    </Box>
  );
}

/** Compact list item */
function CompactFileLink({ file, meta: subtitle }: { file: RecentFile; meta: string }) {
  const typeMeta = FILE_TYPE_METADATA[file.fileType as keyof typeof FILE_TYPE_METADATA];
  const FileIcon = typeMeta?.icon;
  const color = typeMeta?.color ?? 'fg.muted';

  return (
    <Link href={`/f/${generateFileUrl(file.fileId, file.fileName)}`}>
      <HStack
        gap={2.5}
        py={1.5}
        px={2}
        borderRadius="md"
        cursor="pointer"
        transition="all 0.15s ease"
        _hover={{ bg: 'bg.surface' }}
      >
        {FileIcon && (
          <Icon as={FileIcon} color={color} boxSize={3} flexShrink={0} />
        )}
        <Box flex="1" minW={0}>
          <Text fontSize="xs" fontWeight="500" color="fg.default" truncate fontFamily="mono">
            {file.fileName}
          </Text>
        </Box>
        <Text fontSize="2xs" color="fg.subtle" flexShrink={0} fontFamily="mono">
          {subtitle}
        </Text>
      </HStack>
    </Link>
  );
}


const SUMMARY_COLLAPSED_LINES = 5;
const SUMMARY_CHARS_PER_LINE = 45;

function SummaryCollapsible({ summary }: { summary: string }) {
  const [expanded, setExpanded] = useState(false);
  const maxLen = (SUMMARY_COLLAPSED_LINES - 1) * SUMMARY_CHARS_PER_LINE;
  const maxMaxLen = SUMMARY_COLLAPSED_LINES * SUMMARY_CHARS_PER_LINE;
  const needsCollapse = summary.length > maxMaxLen;
  const displayText = !expanded && needsCollapse
    ? summary.slice(0, maxLen).trimEnd() + '...'
    : summary;

  return (
    <Box lineHeight="1.55">
      <Markdown textColor="fg.muted" fontSize="xs">{displayText}</Markdown>
      {needsCollapse && (
        <Text
          as="button"
          fontSize="2xs"
          fontFamily="mono"
          color="fg.subtle"
          cursor="pointer"
          mt={0.5}
          _hover={{ color: 'accent.teal' }}
          transition="all 0.15s"
          onClick={() => setExpanded(e => !e)}
        >
          {expanded ? 'See less' : 'See more'}
        </Text>
      )}
    </Box>
  );
}

/** Compact conversation link for the feed */
function CompactConversationLink({ conversation }: { conversation: ConversationSummary }) {
  return (
    <Link href={`/explore/${conversation.id}`}>
      <HStack
        gap={2.5}
        py={1.5}
        px={2}
        borderRadius="md"
        cursor="pointer"
        transition="all 0.15s ease"
        _hover={{ bg: 'bg.surface' }}
        overflow="hidden"
      >
        <Icon as={LuMessageSquare} color="fg.muted" boxSize={3} flexShrink={0} />
        <Text flex="1" minW={0} fontSize="xs" fontWeight="500" color="fg.default" truncate fontFamily="mono">
          {conversation.name}
        </Text>
        <Text fontSize="2xs" color="fg.subtle" flexShrink={0} fontFamily="mono">
          {relativeTime(conversation.updatedAt)}
        </Text>
      </HStack>
    </Link>
  );
}

function FeedWrapper({ enabled, children }: { enabled?: boolean; children: React.ReactNode }) {
  if (!enabled) return <>{children}</>;
  return (
    <Box bg="bg.muted" borderRadius="md" px={5} py={3}>
      {children}
    </Box>
  );
}

// ─── Shared data context so split sections share one fetch ───────────

interface FeedDataContextValue {
  data: HomeAnalyticsData | null;
  summary: string | null;
  summaryLoading: boolean;
  recentConversations: ConversationSummary[];
  convLoaded: boolean;
  fetchSummary: (files: RecentFile[], skipCache?: boolean) => Promise<void>;
}

const FeedDataContext = createContext<FeedDataContextValue | null>(null);

function useFeedData() {
  const ctx = useReactContext(FeedDataContext);
  if (!ctx) throw new Error('useFeedData must be used within FeedDataProvider');
  return ctx;
}

/** Provider that fetches analytics + conversations once, shares via context */
function FeedDataProvider({ children }: { children: React.ReactNode }) {
  const homePageConfig = useAppSelector(selectHomePage);
  const user = useAppSelector(state => state.auth.user);
  const modeRoot = resolveHomeFolderSync(user?.mode ?? 'org', user?.home_folder ?? '');
  const { documentation: contextDocs } = useContext(`${modeRoot}/context`);
  const [data, setData] = useState<HomeAnalyticsData | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const { data: convData } = useFetch(API.conversations.listRecent);
  const recentConversations: ConversationSummary[] = (convData as any)?.conversations || [];

  useEffect(() => {
    fetch('/api/analytics/recent-files')
      .then(res => res.json())
      .then(json => {
        if (json.success) setData(json.data);
      })
      .catch(() => {});
  }, []);

  const fetchSummary = useCallback(async (files: RecentFile[], skipCache = false) => {
    const questionIds = homePageConfig.feedSummaryQuestionIds.length > 0
      ? homePageConfig.feedSummaryQuestionIds
      : files.filter(f => f.fileType === 'question').slice(0, 3).map(f => f.fileId);

    if (questionIds.length === 0) return;

    setSummaryLoading(true);
    try {
      const augmented = await readFiles(questionIds, { runQueries: true });

      const hasData = augmented.some(aug => {
        return aug.queryResults?.some(qr => qr.rows && qr.rows.length > 0);
      });
      if (!hasData) {
        setSummaryLoading(false);
        return;
      }

      const appState = augmented.map(aug => compressAugmentedFile(aug, Infinity));
      const fullAppState = { files: appState, context: contextDocs || '' };

      const json = await fetchWithCache<{ success: boolean; summary?: string }>('/api/feed-summary', {
        method: 'POST',
        body: JSON.stringify({ appState: fullAppState, prompt: homePageConfig.feedSummaryPrompt || undefined }),
        cacheStrategy: { ttl: 10 * 60 * 1000, deduplicate: true },
        skipCache,
      });
      if (json.success && json.summary) setSummary(json.summary);
    } catch (err) {
      console.error('[FeedSummary] Error:', err);
    } finally {
      setSummaryLoading(false);
    }
  }, [contextDocs, homePageConfig.feedSummaryPrompt, homePageConfig.feedSummaryQuestionIds]);

  useEffect(() => {
    if (!data) return;
    fetchSummary(data.recent);
  }, [data, fetchSummary]);

  return (
    <FeedDataContext.Provider value={{
      data,
      summary,
      summaryLoading,
      recentConversations,
      convLoaded: !!convData,
      fetchSummary,
    }}>
      {children}
    </FeedDataContext.Provider>
  );
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

function FeedSummaryInner({ agentName }: { agentName: string }) {
  const { data, summary, summaryLoading, fetchSummary } = useFeedData();

  if (!summary && !summaryLoading) return null;

  return (
    <VStack gap={3} align="stretch">
      <HStack justify="space-between" align="center">
        <Text fontSize="xs" fontWeight="700" fontFamily="mono" color="accent.teal" letterSpacing="0.1em" textTransform="uppercase">
          {agentName} feed
        </Text>
        {data && summary && (
          <Box
            as="button"
            aria-label="Re-generate summary"
            onClick={() => fetchSummary(data.recent, true)}
            display="inline-flex"
            alignItems="center"
            gap={1}
            px={1.5}
            py={0.5}
            borderRadius="sm"
            fontSize="2xs"
            fontFamily="mono"
            color="fg.subtle"
            cursor={summaryLoading ? 'default' : 'pointer'}
            opacity={summaryLoading ? 0.4 : 0.6}
            _hover={summaryLoading ? {} : { color: 'accent.teal', opacity: 1 }}
            transition="all 0.15s"
          >
            <Icon as={LuRefreshCw} boxSize={2.5} css={summaryLoading ? { animation: 'spin 1s linear infinite' } : {}} />
            Re-generate summary
          </Box>
        )}
      </HStack>

      {summaryLoading && !summary ? (
        <VStack gap={2} align="stretch">
          <Skeleton height="10px" width="100%" borderRadius="sm" />
          <Skeleton height="10px" width="90%" borderRadius="sm" />
          <Skeleton height="10px" width="75%" borderRadius="sm" />
        </VStack>
      ) : summary ? (
        <SummaryCollapsible summary={summary} />
      ) : null}
    </VStack>
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
            <CompactFileLink key={file.fileId} file={file} meta={relativeTime(file.lastVisited)} />
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
  const { showSuggestedPrompts } = useAppSelector(selectHomePage);

  if (!showSuggestedPrompts) return null;

  const handleClick = (prompt: string) => {
    dispatch(setActiveConversation(null));
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

// ─── Legacy combined FeedContent (used by sidebar wrapper) ───────────

/** Shared feed content — used by both standalone column and sidebar */
export function FeedContent({ wrapper }: { wrapper?: boolean } = {}) {
  const { config } = useConfigs();
  const homePageConfig = useAppSelector(selectHomePage);
  const user = useAppSelector(state => state.auth.user);
  const modeRoot = resolveHomeFolderSync(user?.mode ?? 'org', user?.home_folder ?? '');
  const { documentation: contextDocs } = useContext(`${modeRoot}/context`);
  const [data, setData] = useState<HomeAnalyticsData | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const { data: convData } = useFetch(API.conversations.listRecent);
  const recentConversations: ConversationSummary[] = (convData as any)?.conversations || [];

  useEffect(() => {
    fetch('/api/analytics/recent-files')
      .then(res => res.json())
      .then(json => {
        if (json.success) setData(json.data);
      })
      .catch(() => {});
  }, []);

  const fetchSummary = useCallback(async (files: RecentFile[], skipCache = false) => {
    const questionIds = homePageConfig.feedSummaryQuestionIds.length > 0
      ? homePageConfig.feedSummaryQuestionIds
      : files.filter(f => f.fileType === 'question').slice(0, 3).map(f => f.fileId);

    if (questionIds.length === 0) return;

    setSummaryLoading(true);
    try {
      const augmented = await readFiles(questionIds, { runQueries: true });

      // Skip summary if no files have actual query results
      const hasData = augmented.some(aug => {
        return aug.queryResults?.some(qr => qr.rows && qr.rows.length > 0);
      });
      if (!hasData) {
        setSummaryLoading(false);
        return;
      }

      const appState = augmented.map(aug => compressAugmentedFile(aug, Infinity));
      const fullAppState = { files: appState, context: contextDocs || '' };

      const json = await fetchWithCache<{ success: boolean; summary?: string }>('/api/feed-summary', {
        method: 'POST',
        body: JSON.stringify({ appState: fullAppState, prompt: homePageConfig.feedSummaryPrompt || undefined }),
        cacheStrategy: { ttl: 10 * 60 * 1000, deduplicate: true },
        skipCache,
      });
      if (json.success && json.summary) setSummary(json.summary);
    } catch (err) {
      console.error('[FeedSummary] Error:', err);
    } finally {
      setSummaryLoading(false);
    }
  }, [contextDocs, homePageConfig.feedSummaryPrompt, homePageConfig.feedSummaryQuestionIds]);

  useEffect(() => {
    if (!data) return;
    fetchSummary(data.recent);
  }, [data, fetchSummary]);

  const analyticsLoading = !data;
  const hasRecent = (data?.recent.length ?? 0) > 0;
  const hasConversations = recentConversations.length > 0;
  const hasAnything = hasRecent || hasConversations;

  // Nothing loaded yet — show skeleton
  if (analyticsLoading) {
    if (!convData) {
      return (
        <FeedWrapper enabled={wrapper}><VStack gap={4} align="stretch">
          <Text fontSize="xs" fontWeight="700" fontFamily="mono" color="accent.teal" letterSpacing="0.1em" textTransform="uppercase">
            {config.branding.agentName}  feed
          </Text>
          <VStack gap={2} align="stretch">
            <Box h="10px" w="100%" bg="border.default" borderRadius="sm" opacity={0.5} css={{ animation: 'pulse 1.5s ease-in-out infinite' }} />
            <Box h="10px" w="85%" bg="border.default" borderRadius="sm" opacity={0.5} css={{ animation: 'pulse 1.5s ease-in-out infinite', animationDelay: '0.1s' }} />
            <Box h="10px" w="70%" bg="border.default" borderRadius="sm" opacity={0.5} css={{ animation: 'pulse 1.5s ease-in-out infinite', animationDelay: '0.2s' }} />
          </VStack>
          <Box h="1px" bg="border.default" />
          <Box h="200px" bg="border.default" borderRadius="lg" opacity={0.3} css={{ animation: 'pulse 1.5s ease-in-out infinite', animationDelay: '0.3s' }} />
          <Box h="1px" bg="border.default" />
          {[0, 1, 2].map(i => (
            <Box key={i} h="10px" w={`${80 - i * 10}%`} bg="border.default" borderRadius="sm" opacity={0.4} css={{ animation: 'pulse 1.5s ease-in-out infinite', animationDelay: `${0.4 + i * 0.1}s` }} />
          ))}
        </VStack></FeedWrapper>
      );
    }
    if (!hasConversations) return null;
  }

  // Everything loaded but nothing to show
  if (!analyticsLoading && !hasAnything) return null;

  const recentQuestions = data?.recent.filter(f => f.fileType === 'question') ?? [];
  const recentDashboards = data?.recent.filter(f => f.fileType === 'dashboard') ?? [];

  return (
    <FeedWrapper enabled={wrapper}><VStack gap={4} align="stretch">
      {/* Section title + re-run */}
      <HStack justify="space-between" align="center">
        <Text fontSize="xs" fontWeight="700" fontFamily="mono" color="accent.teal" letterSpacing={"0.1em"} textTransform={"uppercase"}>
          {config.branding.agentName}  feed
        </Text>
        {data && summary && (
          <Box
            as="button"
            aria-label="Re-generate summary"
            onClick={() => fetchSummary(data.recent, true)}
            display="inline-flex"
            alignItems="center"
            gap={1}
            px={1.5}
            py={0.5}
            borderRadius="sm"
            fontSize="2xs"
            fontFamily="mono"
            color="fg.subtle"
            cursor={summaryLoading ? 'default' : 'pointer'}
            opacity={summaryLoading ? 0.4 : 0.6}
            _hover={summaryLoading ? {} : { color: 'accent.teal', opacity: 1 }}
            transition="all 0.15s"
          >
            <Icon as={LuRefreshCw} boxSize={2.5} css={summaryLoading ? { animation: 'spin 1s linear infinite' } : {}} />
            Re-generate summary
          </Box>
        )}
      </HStack>

      {/* Summary */}
      {(summary || (summaryLoading && hasRecent)) && (
        <Box>
          {summaryLoading && !summary ? (
            <Text fontSize="xs" color="fg.subtle" fontFamily="mono" fontStyle="italic">
              Generating summary...
            </Text>
          ) : summary ? (
            <SummaryCollapsible summary={summary} />
          ) : null}
        </Box>
      )}

      {/* Recently viewed — questions carousel */}
      {homePageConfig.showRecentQuestions && hasRecent && recentQuestions.length > 0 && (
        <>
          <SectionHeader label="Recently viewed" />
          <QuestionCarousel questions={recentQuestions} />
        </>
      )}

      {/* Recent dashboards */}
      {homePageConfig.showRecentDashboards && hasRecent && recentDashboards.length > 0 && (
        <>
          <SectionHeader label="Recent dashboards" />
          <VStack gap={1.5} align="stretch">
            {recentDashboards.map(file => (
              <CompactFileLink key={file.fileId} file={file} meta={relativeTime(file.lastVisited)} />
            ))}
          </VStack>
        </>
      )}

      {/* Recent conversations */}
      {homePageConfig.showRecentConversations && recentConversations.length > 0 && (
        <>
          <SectionHeader label="Recent conversations" />
          <VStack gap={1.5} align="stretch">
            {recentConversations.map(conv => (
              <CompactConversationLink key={conv.id} conversation={conv} />
            ))}
          </VStack>
        </>
      )}

    </VStack></FeedWrapper>
  );
}

/** Standalone column wrapper for the home page */
export default function RecentFilesSection() {
  const { isCollapsed } = useAppSelector(selectRightSidebarUIState);
  const devMode = useAppSelector(selectDevMode);

  // Hide standalone column when right sidebar is open (content moves to sidebar tab)
  if (!isCollapsed && !devMode) return null;

  return (
    <Box
      w={{ base: '0', lg: '480px' }}
      display={{ base: 'none', lg: 'block' }}
      flexShrink={0}
      position="sticky"
      top="0"
      alignSelf="flex-start"
    >
      <FeedContent wrapper />
    </Box>
  );
}
