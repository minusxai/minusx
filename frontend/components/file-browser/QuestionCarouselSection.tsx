'use client';

import { useState, useCallback } from 'react';
import { Box, HStack, Skeleton } from '@chakra-ui/react';
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu';
import SmartEmbeddedQuestionContainer from '@/components/containers/SmartEmbeddedQuestionContainer';
import type { RecentFile } from '@/lib/analytics/file-analytics.types';

/** Skeleton for the chart carousel */
export function CarouselSkeleton() {
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

// Chart types we want surfaced first in the carousel — they read best as
// standalone visuals. Lower number = higher priority. Everything else
// (table, pivot, single_value, pie, funnel, …) falls into the default tier.
const VIZ_PRIORITY: Record<string, number> = { area: 0, bar: 1, line: 2, funnel: 3, pie: 4 };
const DEFAULT_VIZ_PRIORITY = 10;
const vizPriority = (f: RecentFile) => VIZ_PRIORITY[f.vizType ?? ''] ?? DEFAULT_VIZ_PRIORITY;

/** Carousel with nav dots for questions */
export function QuestionCarousel({ questions: unsorted }: { questions: RecentFile[] }) {
  const [activeIdx, setActiveIdx] = useState(0);

  // Stable sort: bar/line/area first, relevance order preserved within each tier.
  const questions = [...unsorted].sort((a, b) => vizPriority(a) - vizPriority(b));

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
