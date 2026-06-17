'use client';

import { Box, HStack, VStack, Text, Icon, Flex } from '@chakra-ui/react';
import {
  LuTrendingUp,
  LuTriangleAlert,
  LuSparkles,
  LuArrowRight,
  LuZap,
} from 'react-icons/lu';
import { useAppDispatch } from '@/store/hooks';
import {
  setSidebarPendingMessage,
  setActiveSidebarSection,
  setRightSidebarCollapsed,
} from '@/store/uiSlice';
import { useClearChat } from '@/components/explore/slash-commands';

// ────────────────────────────────────────────────────────────────────
// Demo branch: the proactive signals below are synthesised so the home
// surface reads like a live, attentive analyst. Each card opens chat with
// a tailored prompt — swap for real feed data when the endpoints catch up.
// ────────────────────────────────────────────────────────────────────

interface Signal {
  kind: 'alert' | 'trend' | 'opportunity' | 'watch';
  icon: React.ElementType;
  color: string;
  tag: string;
  title: string;
  detail: string;
  prompt: string;
}

const SIGNALS: Signal[] = [
  {
    kind: 'alert', icon: LuTriangleAlert, color: 'accent.warning', tag: 'Anomaly',
    title: 'Latest week revenue down 38%',
    detail: 'Almost certainly a partial week — confirm before anyone panics.',
    prompt: 'Why did revenue drop 38% in the most recent week? Is it a partial/incomplete week?',
  },
  {
    kind: 'trend', icon: LuTrendingUp, color: 'accent.teal', tag: 'Trend',
    title: 'Weekend dinner orders up 21%',
    detail: 'Your fastest-growing segment over the last 6 weeks.',
    prompt: 'Break down weekend dinner orders growth over the last 6 weeks by region and cuisine.',
  },
  {
    kind: 'opportunity', icon: LuSparkles, color: 'accent.secondary', tag: 'Opportunity',
    title: '3 SKUs are bought together but never bundled',
    detail: 'A bundle could lift average order value past $30.',
    prompt: 'Which products are frequently bought together but not bundled? Estimate the AOV upside of bundling them.',
  },
  {
    kind: 'watch', icon: LuZap, color: 'accent.danger', tag: 'Watch',
    title: 'Tuesday lunch cohort churn rising',
    detail: '3 weeks of decline — worth a targeted win-back.',
    prompt: 'Investigate churn in the Tuesday lunch cohort over the last 3 weeks and suggest a win-back plan.',
  },
];

function SignalCard({ signal, idx, onAsk }: { signal: Signal; idx: number; onAsk: (p: string) => void }) {
  return (
    <Box
      className={`mx-rise-${Math.min(idx + 1, 5)}`}
      as="button"
      textAlign="left"
      w="100%"
      onClick={() => onAsk(signal.prompt)}
      position="relative"
      borderRadius="lg"
      px={3}
      py={3}
      cursor="pointer"
      transition="background 0.15s ease"
      _hover={{ bg: 'bg.surface' }}
      css={{
        '&:hover .mx-sig-go': { opacity: 1, transform: 'translateX(0)' },
        '&:hover .mx-sig-chip': { transform: 'scale(1.06)' },
      }}
    >
      <HStack align="center" gap={3}>
        <Flex
          className="mx-sig-chip"
          flexShrink={0} w="32px" h="32px" borderRadius="lg"
          align="center" justify="center"
          bg={`${signal.color}/12`}
          transition="transform 0.15s ease"
        >
          <Icon as={signal.icon} color={signal.color} boxSize={4} />
        </Flex>
        <Box flex="1" minW={0}>
          <HStack gap={2} mb={1} align="center">
            <Text fontFamily="mono" fontSize="3xs" letterSpacing="0.1em" textTransform="uppercase"
              color={signal.color} fontWeight="700" flexShrink={0}>
              {signal.tag}
            </Text>
            <Box flex="1" h="1px" bg="border.subtle" />
          </HStack>
          <Text fontSize="xs" fontWeight="600" color="fg.default" lineHeight="1.35" mb={0.5}>
            {signal.title}
          </Text>
          <Text fontSize="2xs" color="fg.muted" lineHeight="1.4" fontFamily="mono">
            {signal.detail}
          </Text>
        </Box>
        <Icon as={LuArrowRight} className="mx-sig-go" color={signal.color} boxSize={3.5}
          flexShrink={0} opacity={0} transform="translateX(-4px)" transition="all 0.15s ease" />
      </HStack>
    </Box>
  );
}

/** Proactive AI-surfaced signals — replaces the old "Try these" prompts. */
export function SignalsFeed() {
  const dispatch = useAppDispatch();
  const clearChat = useClearChat();

  const ask = (prompt: string) => {
    clearChat();
    dispatch(setSidebarPendingMessage(prompt));
    dispatch(setActiveSidebarSection('chat'));
    dispatch(setRightSidebarCollapsed(false));
  };

  return (
    <VStack align="stretch" gap={3}>
      <HStack gap={2}>
        <Icon as={LuSparkles} color="accent.teal" boxSize={3.5} />
        <Text fontFamily="mono" fontSize="2xs" fontWeight="700" letterSpacing="0.12em"
          textTransform="uppercase" color="fg.subtle">
          Signals for you
        </Text>
        <Box flex="1" h="1px" bg="border.muted" />
        <Text fontFamily="mono" fontSize="3xs" color="accent.teal" fontWeight="700">
          {SIGNALS.length} new
        </Text>
      </HStack>
      <VStack align="stretch" gap={1.5}>
        {SIGNALS.map((s, i) => <SignalCard key={s.title} signal={s} idx={i} onAsk={ask} />)}
      </VStack>
    </VStack>
  );
}
