'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Box, HStack, Text, VStack, Icon } from '@chakra-ui/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LuChevronLeft, LuChevronRight, LuRefreshCw } from 'react-icons/lu';
import { FILE_TYPE_METADATA } from '@/lib/ui/file-metadata';
import { generateFileUrl } from '@/lib/slug-utils';
import SmartEmbeddedQuestionContainer from '@/components/containers/SmartEmbeddedQuestionContainer';
import { useAppSelector } from '@/store/hooks';
import { selectRightSidebarUIState, selectShowRecentFiles, selectDevMode } from '@/store/uiSlice';
import { readFiles } from '@/lib/api/file-state';
import { compressAugmentedFile } from '@/lib/api/compress-augmented';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { useContext } from '@/lib/hooks/useContext';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import type { RecentFile } from '@/lib/analytics/file-analytics.types';
import Markdown from '@/components/Markdown';

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

/** Live chart card using the same component as DashboardView */
function QuestionChartCard({ file }: { file: RecentFile }) {
  const router = useRouter();
  return (
    <Box
      borderRadius="lg"
      bg="bg.surface"
      overflow="hidden"
      h="340px"
      display="flex"
      flexDirection="column"
      transition="all 0.2s ease"
      cursor="pointer"
      onClick={() => router.push(`/f/${generateFileUrl(file.fileId, file.fileName)}`)}
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
        _hover={{ bg: 'bg.muted' }}
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

function SummaryCollapsible({ summary }: { summary: string }) {
  const [expanded, setExpanded] = useState(false);
  const maxLen = (SUMMARY_COLLAPSED_LINES - 1) * 60;
  const maxMaxLen = SUMMARY_COLLAPSED_LINES * 60;
  const needsCollapse = summary.length > maxMaxLen;
  const displayText = !expanded && needsCollapse
    ? summary.slice(0, maxLen).trimEnd() + '...'
    : summary;

  return (
    <Box>
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

/** Shared feed content — used by both standalone column and sidebar */
export function FeedContent() {
  const { config } = useConfigs();
  const devMode = useAppSelector(selectDevMode);
  const showRecentFiles = useAppSelector(selectShowRecentFiles);
  const user = useAppSelector(state => state.auth.user);
  const modeRoot = resolveHomeFolderSync(user?.mode ?? 'org', user?.home_folder ?? '');
  const { documentation: contextDocs } = useContext(`${modeRoot}/context`);
  const [data, setData] = useState<HomeAnalyticsData | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const lastAppStateRef = useRef<any>(null);

  useEffect(() => {
    if (!showRecentFiles) return;
    fetch('/api/analytics/recent-files')
      .then(res => res.json())
      .then(json => {
        if (json.success) setData(json.data);
      })
      .catch(() => {});
  }, [showRecentFiles]);

  const fetchSummary = useCallback(async (files: RecentFile[]) => {
    if (files.length === 0) return;

    const questionIds = files
      .filter(f => f.fileType === 'question')
      .slice(0, 3)
      .map(f => f.fileId);

    setSummaryLoading(true);
    try {
      const augmented = await readFiles(questionIds, { runQueries: true });
      const appState = augmented.map(aug => compressAugmentedFile(aug, Infinity));

      const fullAppState = { files: appState, context: contextDocs || '' };
      lastAppStateRef.current = fullAppState;
      console.log('[FeedSummary] Request:', fullAppState);

      const res = await fetch('/api/feed-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appState: fullAppState }),
      });
      const json = await res.json();
      console.log('[FeedSummary] Response:', json);
      if (json.success && json.summary) setSummary(json.summary);
    } catch (err) {
      console.error('[FeedSummary] Error:', err);
    } finally {
      setSummaryLoading(false);
    }
  }, [contextDocs]);

  useEffect(() => {
    if (!data) return;
    fetchSummary(data.recent);
  }, [data, fetchSummary]);

  if (!showRecentFiles) return null;
  if (!data && !devMode) return null;

  const hasRecent = (data?.recent.length ?? 0) > 0;
  if (!hasRecent && !devMode) return null;

  const recentQuestions = data?.recent.filter(f => f.fileType === 'question') ?? [];
  const recentDashboards = data?.recent.filter(f => f.fileType === 'dashboard') ?? [];

  return (
    <VStack gap={4} align="stretch">
      {/* Section title + re-run */}
      <HStack justify="space-between" align="center">
        <Text fontSize="xs" fontWeight="700" fontFamily="mono" color="accent.teal" letterSpacing={"0.1em"} textTransform={"uppercase"}>
          {config.branding.agentName}  feed
        </Text>
        {data && (
          <Box
            as="button"
            aria-label="Re-generate summary"
            onClick={() => fetchSummary(data.recent)}
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
      {(summary || summaryLoading || devMode) && (
        <Box>
          {summaryLoading && !summary ? (
            <Text fontSize="xs" color="fg.subtle" fontFamily="mono" fontStyle="italic">
              Generating summary...
            </Text>
          ) : summary ? (
            <SummaryCollapsible summary={summary} />
          ) : null}
          {devMode && lastAppStateRef.current && (
            <Box as="details" mt={2} fontSize="2xs" fontFamily="mono" color="fg.subtle">
              <Box as="summary" cursor="pointer" _hover={{ color: 'fg.muted' }}>
                app_state
              </Box>
              <Box
                mt={1}
                p={2}
                bg="bg.canvas"
                borderRadius="sm"
                border="1px solid"
                borderColor="border.default"
                maxH="300px"
                overflowY="auto"
                whiteSpace="pre-wrap"
                wordBreak="break-all"
              >
                {JSON.stringify(lastAppStateRef.current, null, 2)}
              </Box>
            </Box>
          )}
        </Box>
      )}

      {/* Recently viewed — questions carousel */}
      {hasRecent && recentQuestions.length > 0 && (
        <>
          <HStack gap={2}>
            <Box flex="1" h="1px" bg="border.default" />
            <Text fontSize="2xs" fontFamily="mono" fontWeight="500" color="fg.subtle" textTransform="uppercase" letterSpacing="wider" flexShrink={0}>
              Recently viewed
            </Text>
          </HStack>
          <QuestionCarousel questions={recentQuestions} />
        </>
      )}

      {/* Recent dashboards */}
      {hasRecent && recentDashboards.length > 0 && (
        <>
          <HStack gap={2}>
            <Box flex="1" h="1px" bg="border.default" />
            <Text fontSize="2xs" fontFamily="mono" fontWeight="500" color="fg.subtle" textTransform="uppercase" letterSpacing="wider" flexShrink={0}>
              Recent dashboards
            </Text>
          </HStack>
          <VStack gap={1.5} align="stretch">
            {recentDashboards.map(file => (
              <CompactFileLink key={file.fileId} file={file} meta={relativeTime(file.lastVisited)} />
            ))}
          </VStack>
        </>
      )}

    </VStack>
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
      bg="bg.muted"
      borderRadius={"md"}
      px={5}
      py={3}
    >
      <FeedContent />
    </Box>
  );
}
