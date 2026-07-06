'use client';

import { useEffect, useState, useCallback, createContext, useContext as useReactContext } from 'react';
import { Box, HStack, Text, VStack, Icon, Skeleton } from '@chakra-ui/react';
import { LuRefreshCw } from 'react-icons/lu';
import { useAppSelector } from '@/store/hooks';
import { selectHomePage } from '@/store/uiSlice';
import { readFiles } from '@/lib/file-state/file-state';
import { compressAugmentedFile } from '@/lib/chat/compress-augmented';
import { appStateForLlm, type AppState } from '@/lib/appState';
import { todayISO } from '@/lib/utils/today';
import { useContext } from '@/lib/hooks/useContext';
import { inlineContextDocsText } from '@/lib/sql/context-docs';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import type { RecentFile } from '@/lib/analytics/file-analytics.types';
import Markdown from '@/components/Markdown';
import { useFetch } from '@/lib/http/useFetch';
import { API } from '@/lib/http/declarations';
import { fetchWithCache } from '@/lib/http/fetch-wrapper';
import type { ConversationSummary } from '@/app/api/conversations/route';
import type { HomeAnalyticsData } from './RecentFilesSection';

/**
 * Request a home-feed summary via the generic micro-task route. Feed-summary is
 * the `feed_summary` micro task: the app state is serialized into the `app_state`
 * prompt var here, then the task runs server-side.
 */
async function requestFeedSummary(
  fullAppState: { files: unknown[]; context: string },
  skipCache: boolean,
): Promise<string | undefined> {
  const json = await fetchWithCache<{ success: boolean; result?: string }>('/api/micro-task', {
    method: 'POST',
    body: JSON.stringify({
      task: 'feed_summary',
      vars: {
        agent_name: 'MinusX',
        current_date: todayISO(),
        app_state: JSON.stringify(appStateForLlm(fullAppState as unknown as AppState), null, 2),
      },
    }),
    cacheStrategy: { ttl: 10 * 60 * 1000, deduplicate: true },
    skipCache,
  });
  return json.success ? json.result : undefined;
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
export function FeedDataProvider({ children }: { children: React.ReactNode }) {
  const homePageConfig = useAppSelector(selectHomePage);
  const user = useAppSelector(state => state.auth.user);
  const modeRoot = resolveHomeFolderSync(user?.mode ?? 'org', user?.home_folder ?? '');
  const { contextDocs: resolvedContextDocs } = useContext(`${modeRoot}/context`);
  const contextDocs = resolvedContextDocs ? inlineContextDocsText(resolvedContextDocs) : '';
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

      const summary = await requestFeedSummary(fullAppState, skipCache);
      if (summary) setSummary(summary);
    } catch (err) {
      console.error('[FeedSummary] Error:', err);
    } finally {
      setSummaryLoading(false);
    }
  }, [contextDocs, homePageConfig.feedSummaryQuestionIds]);

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

export function FeedSummaryInner({ agentName }: { agentName: string }) {
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
