'use client';

import { memo } from 'react';
import { Box, VStack, HStack, Grid, GridItem, SimpleGrid, Heading, Text, Icon, Badge } from '@chakra-ui/react';
import { LuTriangleAlert, LuTrendingUp, LuEye, LuActivity, LuChartLine, LuSparkles, LuSearch, LuTarget } from 'react-icons/lu';
import type { IconType } from 'react-icons';
import { useAppSelector } from '@/store/hooks';
import { selectEffectiveUser } from '@/store/authSlice';
import { DemoAgent, AgentInsight, InsightTone, AGENT_ICONS } from '@/lib/agents/demo-agents';

interface AgentWelcomeProps {
  agent: DemoAgent;
  onPromptClick: (prompt: string) => void;
  colSpan: any;
  colStart: any;
}

const TONE_CONFIG: Record<InsightTone, { color: string; label: string; icon: IconType }> = {
  critical: { color: 'accent.danger', label: 'Critical', icon: LuTriangleAlert },
  opportunity: { color: 'accent.success', label: 'Opportunity', icon: LuTrendingUp },
  watch: { color: 'accent.warning', label: 'Watch', icon: LuEye },
};

/** Chip colors and icons rotated across question sections so threads scan as distinct lanes. */
const SECTION_ACCENTS = ['accent.cyan', 'accent.secondary', 'accent.warning', 'accent.primary'];
const SECTION_ICONS: IconType[] = [LuChartLine, LuSparkles, LuSearch, LuTarget];

const ENTRANCE_KEYFRAMES = `
@keyframes agentBriefIn {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes agentScanPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.72); }
}
`;

function entrance(order: number): React.CSSProperties {
  return { animation: `agentBriefIn 0.45s ease-out ${order * 0.09}s both` };
}

function InsightCard({ insight, order }: { insight: AgentInsight; order: number }) {
  const tone = TONE_CONFIG[insight.tone];
  return (
    <VStack
      align="stretch"
      gap={2}
      p={4}
      borderRadius="lg"
      border="1px solid"
      borderColor={`${tone.color}/25`}
      bg={`${tone.color}/6`}
      transition="all 0.2s ease"
      _hover={{ transform: 'translateY(-2px)', borderColor: `${tone.color}/50`, boxShadow: 'sm' }}
      style={entrance(order)}
    >
      <HStack gap={1}>
        <Icon as={tone.icon} boxSize={3} color={tone.color} />
        <Text fontSize="2xs" fontWeight="700" fontFamily="mono" color={tone.color} textTransform="uppercase" letterSpacing="0.08em">
          {tone.label}
        </Text>
      </HStack>
      <HStack gap={2} align="baseline">
        <Text fontSize="2xl" fontWeight="800" fontFamily="mono" color="fg.default" letterSpacing="-0.03em" lineHeight="1" whiteSpace="nowrap">
          {insight.stat}
        </Text>
        <Badge fontSize="2xs" fontFamily="mono" color={tone.color} bg={`${tone.color}/12`} borderRadius="sm" px={1.5} py={0.5}>
          {insight.delta}
        </Badge>
      </HStack>
      <Text fontSize="sm" fontWeight="600" color="fg.default" lineHeight="1.4">
        {insight.title}
      </Text>
      <Text fontSize="xs" color="fg.muted" lineHeight="1.5">
        {insight.detail}
      </Text>
    </VStack>
  );
}

function ThreadCard({
  question,
  section,
  accent,
  icon,
  order,
  onClick,
}: {
  question: string;
  section: string;
  accent: string;
  icon: IconType;
  order: number;
  onClick: () => void;
}) {
  return (
    <HStack
      as="button"
      aria-label={`Ask: ${question}`}
      align="center"
      gap={3}
      px={3.5}
      py={3}
      borderRadius="lg"
      border="1px solid"
      borderColor="border.default"
      bg="bg.surface"
      cursor="pointer"
      textAlign="left"
      width="100%"
      transition="all 0.18s ease"
      _hover={{ borderColor: accent, bg: `${accent}/5`, transform: 'translateX(3px)' }}
      onClick={onClick}
      style={entrance(order)}
    >
      <Box p={1.5} borderRadius="md" bg={`${accent}/10`} flexShrink={0}>
        <Icon as={icon} boxSize={3.5} color={accent} />
      </Box>
      <Badge
        fontSize="2xs"
        fontWeight="700"
        fontFamily="mono"
        textTransform="uppercase"
        letterSpacing="0.06em"
        color={accent}
        bg={`${accent}/10`}
        borderRadius="sm"
        px={2}
        py={1}
        flexShrink={0}
      >
        {section}
      </Badge>
      <Text fontSize="sm" fontWeight="500" color="fg.default" fontFamily="mono" lineHeight="1.4">
        {question}
      </Text>
    </HStack>
  );
}

/**
 * Agent-skinned chat empty state, styled as a proactive executive briefing:
 * a hero panel with flagged insights the agent "already found", then a
 * multi-column grid of conversation threads. Thread clicks send real
 * messages via the same onPromptClick path as the default explore welcome.
 */
function AgentWelcomeImpl({ agent, onPromptClick, colStart: _colStart, colSpan: _colSpan }: AgentWelcomeProps) {
  const user = useAppSelector(selectEffectiveUser);
  const firstName = user?.name?.split(' ')[0].split('@')[0] || 'there';
  const AgentIcon = AGENT_ICONS[agent.icon] ?? AGENT_ICONS.bot;
  const insights = agent.insights ?? [];
  const hasBriefing = insights.length > 0;
  const flatThreads = agent.questionSections.flatMap((section, sectionIndex) =>
    section.questions.map(question => ({
      question,
      section: section.title,
      accent: SECTION_ACCENTS[sectionIndex % SECTION_ACCENTS.length],
      icon: SECTION_ICONS[sectionIndex % SECTION_ICONS.length],
    }))
  );

  return (
    <Grid templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }} gap={2} w="100%">
      <GridItem colSpan={12}>
        <style>{ENTRANCE_KEYFRAMES}</style>
        <VStack gap={6} align="stretch" maxW="960px" mx="auto" py={4} px={{ base: 0, md: 2 }}>

          {hasBriefing ? (
            /* Proactive briefing hero */
            <Box
              borderRadius="xl"
              border="1px solid"
              borderColor="border.muted"
              bg="bg.surface"
              p={{ base: 4, md: 6 }}
              position="relative"
              overflow="hidden"
              style={entrance(0)}
            >
              {/* Dotted grid backdrop */}
              <Box
                position="absolute"
                inset={0}
                opacity={0.5}
                pointerEvents="none"
                backgroundImage="radial-gradient(var(--chakra-colors-border-muted) 1px, transparent 1px)"
                backgroundSize="18px 18px"
              />
              <VStack align="stretch" gap={5} position="relative">
                <HStack justify="space-between" align="center" flexWrap="wrap" gap={2}>
                  <HStack gap={2}>
                    <Box
                      boxSize="8px"
                      borderRadius="full"
                      bg={agent.accent}
                      style={{ animation: 'agentScanPulse 2s ease-in-out infinite' }}
                    />
                    <Text fontSize="2xs" fontWeight="700" fontFamily="mono" color={agent.accent} textTransform="uppercase" letterSpacing="0.12em">
                      Proactive Briefing
                    </Text>
                  </HStack>
                  <HStack gap={2} color="fg.subtle">
                    <Icon as={LuActivity} boxSize={3} />
                    <Text fontSize="2xs" fontFamily="mono" textTransform="uppercase" letterSpacing="0.08em">
                      Live scan · 24 signals · {insights.length} flagged
                    </Text>
                  </HStack>
                </HStack>

                <Heading
                  fontSize={{ base: 'xl', md: '2xl' }}
                  fontWeight="800"
                  fontFamily="mono"
                  color="fg.default"
                  letterSpacing="-0.02em"
                  lineHeight="1.3"
                  maxW="640px"
                >
                  I went ahead and looked, {firstName}.{' '}
                  <Box as="span" color={agent.accent}>{insights.length} things stand out.</Box>
                </Heading>

                <SimpleGrid columns={{ base: 1, md: 3 }} gap={3}>
                  {insights.map((insight, i) => (
                    <InsightCard key={insight.title} insight={insight} order={i + 1} />
                  ))}
                </SimpleGrid>
              </VStack>
            </Box>
          ) : (
            /* Custom agents without briefing data: identity welcome */
            <VStack gap={3} py={4} style={entrance(0)}>
              <Box p={4} borderRadius="full" bg={`${agent.accent}/10`} border="2px solid" borderColor={`${agent.accent}/30`}>
                <Icon as={AgentIcon} boxSize={8} color={agent.accent} />
              </Box>
              <Heading fontSize="xl" fontWeight="800" fontFamily="mono" color="fg.default" letterSpacing="-0.02em">
                {agent.name}
              </Heading>
              <Text color="fg.muted" fontSize="sm" fontFamily="mono" textAlign="center" maxW="480px">
                {agent.greeting}
              </Text>
            </VStack>
          )}

          {/* Thread picker */}
          {flatThreads.length > 0 && (
            <VStack align="stretch" gap={3}>
              <HStack gap={3} align="center" style={entrance(4)}>
                <Box flex="1" height="1px" bg="border.muted" />
                <Text fontSize="2xs" fontWeight="700" fontFamily="mono" color="fg.subtle" textTransform="uppercase" letterSpacing="0.12em" flexShrink={0}>
                  Or pick a thread
                </Text>
                <Box flex="1" height="1px" bg="border.muted" />
              </HStack>
              <SimpleGrid columns={{ base: 1, md: 2 }} gap={2.5}>
                {flatThreads.map((thread, i) => (
                  <ThreadCard
                    key={thread.question}
                    question={thread.question}
                    section={thread.section}
                    accent={thread.accent}
                    icon={thread.icon}
                    order={i + 5}
                    onClick={() => onPromptClick(thread.question)}
                  />
                ))}
              </SimpleGrid>
            </VStack>
          )}
        </VStack>
      </GridItem>
    </Grid>
  );
}

const AgentWelcome = memo(AgentWelcomeImpl);
export default AgentWelcome;
