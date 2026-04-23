'use client';

import { useEffect, useState, useCallback } from 'react';
import { Box, HStack, Text, VStack, Icon, Flex, IconButton } from '@chakra-ui/react';
import Link from 'next/link';
import { LuClock, LuTrendingUp, LuChevronLeft, LuChevronRight } from 'react-icons/lu';
import { FILE_TYPE_METADATA } from '@/lib/ui/file-metadata';
import { generateFileUrl } from '@/lib/slug-utils';
import SmartEmbeddedQuestionContainer from '@/components/containers/SmartEmbeddedQuestionContainer';
import type { RecentFile } from '@/lib/analytics/file-analytics.types';

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
  return (
    <Link href={`/f/${generateFileUrl(file.fileId, file.fileName)}`}>
      <Box
        borderRadius="lg"
        border="1px solid"
        borderColor="border.default"
        bg="bg.surface"
        overflow="hidden"
        h="340px"
        display="flex"
        flexDirection="column"
        transition="all 0.2s ease"
        _hover={{ shadow: 'md' }}
      >
        <SmartEmbeddedQuestionContainer
          questionId={file.fileId}
          showTitle={true}
        />
      </Box>
    </Link>
  );
}

/** Carousel with nav dots for questions */
function QuestionCarousel({ questions }: { questions: RecentFile[] }) {
  const [activeIdx, setActiveIdx] = useState(0);

  const prev = useCallback(() => setActiveIdx(i => (i - 1 + questions.length) % questions.length), [questions.length]);
  const next = useCallback(() => setActiveIdx(i => (i + 1) % questions.length), [questions.length]);

  if (questions.length === 0) return null;
  if (questions.length === 1) return <QuestionChartCard file={questions[0]} />;

  return (
    <Box>
      <QuestionChartCard file={questions[activeIdx]} />
      <HStack justify="center" gap={1} mt={2}>
        <IconButton
          variant="ghost"
          size="2xs"
          aria-label="Previous question"
          onClick={prev}
          color="fg.subtle"
          _hover={{ color: 'fg.default' }}
          borderRadius="full"
          minW="auto"
          h="auto"
          p={0.5}
        >
          <LuChevronLeft size={12} />
        </IconButton>
        {questions.map((_, idx) => (
          <Box
            key={idx}
            w="5px"
            h="5px"
            borderRadius="full"
            bg={idx === activeIdx ? 'accent.primary' : 'fg.subtle'}
            opacity={idx === activeIdx ? 1 : 0.3}
            cursor="pointer"
            transition="all 0.15s"
            onClick={() => setActiveIdx(idx)}
          />
        ))}
        <IconButton
          variant="ghost"
          size="2xs"
          aria-label="Next question"
          onClick={next}
          color="fg.subtle"
          _hover={{ color: 'fg.default' }}
          borderRadius="full"
          minW="auto"
          h="auto"
          p={0.5}
        >
          <LuChevronRight size={12} />
        </IconButton>
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
          <Flex
            align="center"
            justify="center"
            w="20px"
            h="20px"
            borderRadius="sm"
            bg={`${color}/8`}
            flexShrink={0}
          >
            <Icon as={FileIcon} color={color} boxSize={2.5} />
          </Flex>
        )}
        <Box flex="1" minW={0}>
          <Text fontSize="xs" fontWeight="500" color="fg.default" truncate>
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

/** Section header */
function SectionHeader({ icon, title, accent }: { icon: React.ElementType; title: string; accent?: string }) {
  return (
    <HStack gap={1.5} mb={2}>
      <Icon as={icon} boxSize={3} color={accent ?? 'fg.muted'} />
      <Text
        fontSize="2xs"
        fontWeight="700"
        color="fg.muted"
        textTransform="uppercase"
        letterSpacing="wider"
      >
        {title}
      </Text>
    </HStack>
  );
}

export default function RecentFilesSection() {
  const [data, setData] = useState<HomeAnalyticsData | null>(null);

  useEffect(() => {
    fetch('/api/analytics/recent-files')
      .then(res => res.json())
      .then(json => {
        if (json.success) setData(json.data);
      })
      .catch(() => {});
  }, []);

  if (!data) return null;

  const hasRecent = data.recent.length > 0;
  const hasTrending = data.trending.length > 0;

  if (!hasRecent && !hasTrending) return null;

  // Split by type: questions as carousel with live charts, dashboards as list
  const recentQuestions = data.recent.filter(f => f.fileType === 'question');
  const recentDashboards = data.recent.filter(f => f.fileType === 'dashboard');
  const trendingQuestions = data.trending.filter(f => f.fileType === 'question');
  const trendingDashboards = data.trending.filter(f => f.fileType === 'dashboard');

  return (
    <Box
      w={{ base: '0', lg: '480px' }}
      display={{ base: 'none', lg: 'block' }}
      flexShrink={0}
      position="sticky"
      top="20px"
    >
    <VStack gap={5} align="stretch">
      {/* Recent section */}
      {hasRecent && (
        <Box>
          <SectionHeader icon={LuClock} title="Recent" accent="accent.teal" />
          <VStack gap={2} align="stretch">
            {recentQuestions.length > 0 && (
              <QuestionCarousel questions={recentQuestions} />
            )}
            {recentDashboards.map(file => (
              <CompactFileLink
                key={file.fileId}
                file={file}
                meta={relativeTime(file.lastVisited)}
              />
            ))}
          </VStack>
        </Box>
      )}

      {/* Trending section */}
      {hasTrending && (
        <Box>
          <SectionHeader icon={LuTrendingUp} title="Trending in Org" accent="accent.warning" />
          <VStack gap={2} align="stretch">
            {trendingQuestions.length > 0 && (
              <QuestionCarousel questions={trendingQuestions} />
            )}
            {trendingDashboards.map(file => (
              <CompactFileLink
                key={file.fileId}
                file={file}
                meta={relativeTime(file.lastVisited)}
              />
            ))}
          </VStack>
        </Box>
      )}
    </VStack>
    </Box>
  );
}
