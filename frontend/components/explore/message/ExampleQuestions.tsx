'use client';

import { memo, useMemo, useState } from 'react';
import { VStack, Box, HStack, Heading, Text, Icon, Grid, GridItem, SimpleGrid, Flex, Button } from '@chakra-ui/react';
import {
  LuArrowRight,
  LuArrowLeft,
  LuCheck,
  LuRefreshCw,
  LuArrowUpRight,
  LuArrowDownRight,
  LuMinus,
  LuActivity,
  LuCornerDownRight,
} from 'react-icons/lu';
import { useAppSelector } from '@/store/hooks';
import { selectEffectiveUser } from '@/store/authSlice';
import { useConfigs } from '@/lib/hooks/useConfigs';
import {
  DEMO_AGENTS,
  BUSINESS_UNITS,
  DEFAULT_AGENT_SELECTION,
  getDemoAgent,
  getBusinessUnit,
  TAG_META,
  SEVERITY_META,
  WORKSPACE_INSIGHTS,
  type DemoAgent,
  type AgentSelection,
  type ProactiveInsight,
} from '../demo-agents';

interface ExampleQuestionsProps {
  onPromptClick: (prompt: string) => void;
  container?: 'page' | 'sidebar';
  colSpan: any;
  colStart: any;
  /** Shared agent selection (also reflected in the chat-input dropdown). */
  selection?: AgentSelection;
  onSelect?: (selection: AgentSelection) => void;
}

// Scoped keyframes + hover reveal for the agent cards.
const AGENT_CARD_STYLES = `
@keyframes mxAgentCardIn {
  from { opacity: 0; transform: translateY(14px) scale(0.985); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes mxAgentPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.45; transform: scale(0.82); }
}
@keyframes mxRadar {
  0%   { transform: scale(0.7); opacity: 0.7; }
  100% { transform: scale(2.6); opacity: 0; }
}
@keyframes mxBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }
.mx-agent-card { opacity: 0; animation: mxAgentCardIn 0.5s cubic-bezier(0.22, 0.8, 0.28, 1) forwards; }
.mx-agent-dot { animation: mxAgentPulse 2.4s ease-in-out infinite; }
.mx-q-arrow { opacity: 0; transform: translateX(-6px); transition: opacity 0.2s ease, transform 0.2s ease; }
.mx-q-row:hover .mx-q-arrow { opacity: 1; transform: translateX(0); }
/* Futuristic briefing deck */
.mx-deck { position: relative; overflow: hidden; }
.mx-deck::before {
  content: '';
  position: absolute; inset: 0;
  background-image: radial-gradient(circle at 1px 1px, rgba(127, 140, 141, 0.12) 1px, transparent 0);
  background-size: 22px 22px;
  pointer-events: none;
  opacity: 0.6;
}
.mx-radar { animation: mxRadar 2.2s ease-out infinite; }
.mx-blink { animation: mxBlink 1.6s steps(1) infinite; }
.mx-dig { opacity: 0; transform: translateX(-6px); transition: opacity 0.22s ease, transform 0.22s ease; }
.mx-insight:hover .mx-dig { opacity: 1; transform: translateX(0); }
@media (prefers-reduced-motion: reduce) {
  .mx-agent-card, .mx-agent-dot, .mx-radar, .mx-blink { animation: none; opacity: 1; }
}
`;

type Step = 'pick' | 'scope' | 'workspace';

function ExampleQuestionsImpl({
  onPromptClick,
  container,
  colSpan,
  colStart,
  selection = DEFAULT_AGENT_SELECTION,
  onSelect,
}: ExampleQuestionsProps) {
  const user = useAppSelector(selectEffectiveUser);
  const firstName = user?.name?.split(' ')[0].split('@')[0] || 'there';

  // Derive the initial step from the shared selection (so a persona chosen via
  // the chat-input dropdown lands on the right screen on remount).
  const selectedAgent = getDemoAgent(selection.agentId);
  const initialStep: Step = selectedAgent
    ? (selection.businessUnitId ? 'workspace' : 'scope')
    : 'pick';

  const [step, setStep] = useState<Step>(initialStep);
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(selectedAgent?.id ?? null);
  const [pendingBU, setPendingBU] = useState<string | null>(selection.businessUnitId ?? null);

  const pendingAgent = getDemoAgent(pendingAgentId || '');

  // The multi-step agent picker is a page-only experience — the 3-column grid is
  // far too cramped in the narrow sidebar. There we show a simple greeting and
  // let the user start typing (the agent dropdown still lives in the input).
  if (container === 'sidebar') {
    return <SidebarGreeting firstName={firstName} />;
  }

  // Widen the layout for the multi-column grids (page-only — sidebar returned above).
  const wideColSpan = { base: 12, md: 10, lg: 10 };
  const wideColStart = { base: 1, md: 2, lg: 2 };

  const handleLaunch = (agent: DemoAgent) => {
    setPendingAgentId(agent.id);
    setPendingBU(null);
    setStep('scope');
  };

  const handleContinue = () => {
    if (!pendingAgent || !pendingBU) return;
    onSelect?.({ agentId: pendingAgent.id, businessUnitId: pendingBU });
    setStep('workspace');
  };

  const handleSwitchAgent = () => {
    // Back on the agent picker the input always reverts to the General Agent;
    // it only becomes a persona once the scope step is confirmed.
    setPendingAgentId(null);
    setPendingBU(null);
    onSelect?.(DEFAULT_AGENT_SELECTION);
    setStep('pick');
  };

  return (
    <Grid templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }} gap={2} w="100%">
      <GridItem colSpan={wideColSpan} colStart={wideColStart}>
        <style>{AGENT_CARD_STYLES}</style>
        <VStack gap={6} align="stretch" flex="1" py={6}>
          {step === 'pick' && (
            <PickStep firstName={firstName} onLaunch={handleLaunch} onPromptClick={onPromptClick} />
          )}
          {step === 'scope' && pendingAgent && (
            <ScopeStep
              agent={pendingAgent}
              pendingBU={pendingBU}
              onPickBU={setPendingBU}
              onContinue={handleContinue}
              onBack={handleSwitchAgent}
            />
          )}
          {step === 'workspace' && selectedAgent && (
            <WorkspaceStep
              firstName={firstName}
              agent={selectedAgent}
              businessUnitName={getBusinessUnit(selection.businessUnitId)?.name}
              onPromptClick={onPromptClick}
              onSwitchAgent={handleSwitchAgent}
            />
          )}
        </VStack>
      </GridItem>
    </Grid>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar — original welcome header (the full picker is page-only)
// ─────────────────────────────────────────────────────────────────────────────
const greetings = [
  (name: string) => `Hi ${name}, what would you like to explore today?`,
  (name: string) => `Hey ${name}, ready to dig into some data?`,
  (name: string) => `Welcome back ${name}! What can I help you find?`,
  (name: string) => `What's on your mind today, ${name}?`,
];

function SidebarGreeting({ firstName }: { firstName: string }) {
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  const { config } = useConfigs();
  const agentName = config.branding.agentName;
  const isMinusx = agentName.toLowerCase() === 'minusx';
  // Re-randomise on firstName change only (matches the original behaviour).
  const greeting = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity
    const index = Math.floor(Math.random() * greetings.length);
    return greetings[index](firstName);
  }, [firstName]);

  return (
    <VStack gap={6} align="center" justify="center" flex="1" py={8} px={4}>
      <VStack gap={2}>
        {isMinusx ? (
          <Box position="relative" borderRadius="lg" overflow="hidden" p={4}>
            <img
              src={colorMode === 'light' ? '/minusx_explore_dark.svg' : '/minusx_explore.svg'}
              alt="minusx explore"
              style={{ width: '100%', maxWidth: '320px', height: 'auto', position: 'relative' }}
            />
          </Box>
        ) : (
          <>
            <Box p={3} borderRadius="full" bg="accent.teal/10" border="2px solid" borderColor="accent.teal/30">
              <Box aria-label="Workspace logo" role="img" boxSize={6} flexShrink={0} />
            </Box>
            <Heading fontSize="xl" fontWeight="800" fontFamily="mono" color="fg.default" letterSpacing="-0.02em">
              Ask {agentName} anything
            </Heading>
          </>
        )}
        <Text color="fg.muted" fontSize="sm" fontFamily="mono" textAlign="center">
          {greeting}
        </Text>
      </VStack>
    </VStack>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Choose your agent
// ─────────────────────────────────────────────────────────────────────────────
function PickStep({
  firstName,
  onLaunch,
  onPromptClick,
}: {
  firstName: string;
  onLaunch: (agent: DemoAgent) => void;
  onPromptClick: (prompt: string) => void;
}) {
  return (
    <Grid templateColumns={{ base: '1fr', lg: '1.7fr 1fr' }} gap={{ base: 8, lg: 7 }} alignItems="start">
      {/* ── LEFT: pick an agent ─────────────────────────────────────────── */}
      <VStack align="stretch" gap={4}>
        <VStack align="start" gap={1}>
          <Text
            fontSize="2xs"
            fontWeight="700"
            color="accent.teal"
            textTransform="uppercase"
            letterSpacing="0.18em"
            fontFamily="mono"
          >
            Agentic Workspace
          </Text>
          <Heading fontSize="2xl" fontWeight="800" fontFamily="mono" color="fg.default" letterSpacing="-0.02em">
            Choose your agent.
          </Heading>
          <Text color="fg.muted" fontSize="sm" fontFamily="mono">
            Hi {firstName} — each one has already scanned today&apos;s data.
          </Text>
        </VStack>

        <VStack align="stretch" gap={3}>
          {DEMO_AGENTS.map((agent, index) => (
            <Flex
              key={agent.id}
              className="mx-agent-card"
              style={{ animationDelay: `${index * 90}ms` }}
              gap={3}
              p={3.5}
              align="center"
              position="relative"
              borderRadius="xl"
              border="1px solid"
              borderColor="border.default"
              bg="bg.panel"
              cursor="pointer"
              transition="border-color 0.25s ease, box-shadow 0.25s ease, transform 0.25s ease"
              _hover={{
                borderColor: `${agent.color}/45`,
                boxShadow: 'md',
                transform: 'translateY(-2px)',
                '& .mx-go': { bg: agent.color, color: 'white', borderColor: agent.color },
              }}
              aria-label={`Launch ${agent.name}`}
              onClick={() => onLaunch(agent)}
            >
              <Flex
                align="center"
                justify="center"
                boxSize={11}
                borderRadius="lg"
                bg={`${agent.color}/12`}
                border="1px solid"
                borderColor={`${agent.color}/25`}
                flexShrink={0}
              >
                <Icon as={agent.icon} boxSize={5} color={agent.color} />
              </Flex>

              <VStack align="start" gap={1} flex="1" minW={0}>
                <HStack gap={2} align="center">
                  <Text
                    fontSize="2xs"
                    fontWeight="700"
                    color="fg.subtle"
                    textTransform="uppercase"
                    letterSpacing="0.12em"
                    fontFamily="mono"
                  >
                    {agent.tagline}
                  </Text>
                  <HStack gap={1} flexShrink={0}>
                    <Box className="mx-agent-dot" boxSize="5px" borderRadius="full" bg={agent.color} flexShrink={0} />
                    <Text fontSize="2xs" fontWeight="700" color={agent.color} fontFamily="mono" letterSpacing="0.04em">
                      {agent.proactiveInsights.length} signals
                    </Text>
                  </HStack>
                </HStack>
                <Text fontSize="md" fontWeight="700" color="fg.default" fontFamily="mono" lineHeight="1.1">
                  {agent.name}
                </Text>
                <Text fontSize="xs" color="fg.muted" fontFamily="mono" lineHeight="1.5" lineClamp={2}>
                  {agent.description}
                </Text>
              </VStack>

              <Flex
                align="center"
                justify="center"
                boxSize={9}
                borderRadius="lg"
                flexShrink={0}
                border="1px solid"
                borderColor="border.emphasized"
                bg="bg.canvas"
                color="fg.muted"
                transition="background 0.18s ease, color 0.18s ease, border-color 0.18s ease"
                className="mx-go"
              >
                <Icon as={LuArrowRight} boxSize={4} />
              </Flex>
            </Flex>
          ))}
        </VStack>
      </VStack>

      {/* ── RIGHT: proactive findings (persona-agnostic) ────────────────── */}
      <VStack align="stretch" gap={3}>
        <VStack align="start" gap={1}>
          <HStack gap={2} align="center">
            <Box position="relative" boxSize="8px" flexShrink={0}>
              <Box position="absolute" inset={0} borderRadius="full" bg="accent.teal" />
              <Box className="mx-radar" position="absolute" inset={0} borderRadius="full" border="1.5px solid" borderColor="accent.teal" />
            </Box>
            <Text
              fontSize="2xs"
              fontWeight="700"
              color="accent.teal"
              textTransform="uppercase"
              letterSpacing="0.18em"
              fontFamily="mono"
            >
              While you were away
            </Text>
          </HStack>
          <Heading fontSize="2xl" fontWeight="800" fontFamily="mono" color="fg.default" letterSpacing="-0.02em">
            Proactive signals.
          </Heading>
          <Text color="fg.muted" fontSize="sm" fontFamily="mono">
            Surfaced from your latest activity.
          </Text>
        </VStack>

        <VStack align="stretch" gap={3}>
          {WORKSPACE_INSIGHTS.map((insight, idx) => (
            <InsightCard key={idx} insight={insight} index={idx} onClick={() => onPromptClick(insight.prompt)} />
          ))}
        </VStack>
      </VStack>
    </Grid>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Scope the agent to a business unit
// ─────────────────────────────────────────────────────────────────────────────
function ScopeStep({
  agent,
  pendingBU,
  onPickBU,
  onContinue,
  onBack,
}: {
  agent: DemoAgent;
  pendingBU: string | null;
  onPickBU: (id: string) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  return (
    <Box className="mx-agent-card" maxW="2xl" mx="auto" w="100%">
      <VStack
        align="stretch"
        gap={5}
        p={6}
        borderRadius="xl"
        border="1px solid"
        borderColor="border.default"
        bg="bg.panel"
      >
        <VStack align="start" gap={1.5}>
          <Text
            fontSize="2xs"
            fontWeight="700"
            color="accent.teal"
            textTransform="uppercase"
            letterSpacing="0.16em"
            fontFamily="mono"
          >
            Step 2 of 2 · Scope agent
          </Text>
          <Heading fontSize="xl" fontWeight="800" fontFamily="mono" color="fg.default" letterSpacing="-0.01em">
            Which entity should the {agent.name} represent?
          </Heading>
          <Text fontSize="sm" color="fg.muted" fontFamily="mono">
            The {agent.name} will speak from the perspective of the leadership of the selected business unit.
          </Text>
        </VStack>

        {/* Selected agent summary */}
        <HStack
          gap={3}
          p={3}
          borderRadius="lg"
          bg="bg.muted"
          border="1px solid"
          borderColor="border.muted"
        >
          <Flex
            align="center"
            justify="center"
            boxSize={8}
            borderRadius="md"
            bg={`${agent.color}/12`}
            border="1px solid"
            borderColor={`${agent.color}/25`}
            flexShrink={0}
          >
            <Icon as={agent.icon} boxSize={4} color={agent.color} />
          </Flex>
          <VStack align="start" gap={0}>
            <Text fontSize="2xs" color="fg.subtle" fontFamily="mono" textTransform="uppercase" letterSpacing="0.1em">
              Selected agent
            </Text>
            <Text fontSize="sm" fontWeight="700" color="fg.default" fontFamily="mono">
              {agent.name}
            </Text>
          </VStack>
        </HStack>

        {/* Business unit picker */}
        <VStack align="stretch" gap={1.5}>
          <Text fontSize="xs" fontWeight="700" color="fg.default" fontFamily="mono">
            Business Unit <Text as="span" color="accent.danger">*</Text>
          </Text>
          <VStack align="stretch" gap={1.5}>
            {BUSINESS_UNITS.map((bu) => {
              const selected = bu.id === pendingBU;
              return (
                <HStack
                  key={bu.id}
                  gap={3}
                  px={3}
                  py={2.5}
                  borderRadius="lg"
                  cursor="pointer"
                  border="1px solid"
                  borderColor={selected ? `${agent.color}/50` : 'border.muted'}
                  bg={selected ? `${agent.color}/8` : 'transparent'}
                  transition="background 0.15s ease, border-color 0.15s ease"
                  _hover={{ bg: selected ? `${agent.color}/12` : 'bg.muted' }}
                  aria-label={`Select ${bu.name}`}
                  onClick={() => onPickBU(bu.id)}
                >
                  <Flex
                    align="center"
                    justify="center"
                    boxSize={8}
                    borderRadius="md"
                    bg={selected ? `${agent.color}/15` : 'bg.muted'}
                    flexShrink={0}
                    fontSize="2xs"
                    fontWeight="700"
                    fontFamily="mono"
                    color={selected ? agent.color : 'fg.muted'}
                  >
                    {bu.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                  </Flex>
                  <VStack align="start" gap={0} flex="1" minW={0}>
                    <Text fontSize="sm" fontWeight="600" color="fg.default" fontFamily="mono">
                      {bu.name}
                    </Text>
                    <Text fontSize="2xs" color="fg.muted" fontFamily="mono">
                      {bu.subtitle}
                    </Text>
                  </VStack>
                  {selected && <Icon as={LuCheck} boxSize={4} color={agent.color} flexShrink={0} />}
                </HStack>
              );
            })}
          </VStack>
        </VStack>

        {/* Footer */}
        <HStack justify="space-between" pt={1}>
          <Button
            variant="ghost"
            size="sm"
            color="fg.muted"
            fontFamily="mono"
            _hover={{ color: 'fg.default' }}
            aria-label="Change agent"
            onClick={onBack}
          >
            <Icon as={LuArrowLeft} boxSize={3.5} mr={1.5} />
            Change agent
          </Button>
          <Button
            size="sm"
            bg="accent.teal"
            color="white"
            fontFamily="mono"
            fontWeight="600"
            disabled={!pendingBU}
            _hover={{ bg: 'accent.teal', opacity: 0.9 }}
            _disabled={{ opacity: 0.4, cursor: 'not-allowed' }}
            aria-label="Continue"
            onClick={onContinue}
          >
            Continue
            <Icon as={LuArrowRight} boxSize={3.5} ml={1.5} />
          </Button>
        </HStack>
      </VStack>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — Workspace with recommended actions
// ─────────────────────────────────────────────────────────────────────────────
function WorkspaceStep({
  firstName,
  agent,
  businessUnitName,
  onPromptClick,
  onSwitchAgent,
}: {
  firstName: string;
  agent: DemoAgent;
  businessUnitName?: string;
  onPromptClick: (prompt: string) => void;
  onSwitchAgent: () => void;
}) {
  const flagged = agent.proactiveInsights.length;
  return (
    <VStack gap={6} align="stretch">
      {/* Header */}
      <Flex justify="space-between" align="center" gap={3} flexWrap="wrap">
        <HStack gap={3.5} align="center">
          <Flex
            align="center"
            justify="center"
            boxSize={11}
            borderRadius="xl"
            bg={`${agent.color}/12`}
            border="1px solid"
            borderColor={`${agent.color}/25`}
            flexShrink={0}
          >
            <Icon as={agent.icon} boxSize={5} color={agent.color} />
          </Flex>
          <VStack align="start" gap={1.5}>
            <HStack gap={2.5}>
              <Text fontSize="md" fontWeight="700" color="fg.default" fontFamily="mono" lineHeight="1">
                {agent.name}
              </Text>
              {businessUnitName && (
                <Text
                  fontSize="2xs"
                  fontWeight="600"
                  color={agent.color}
                  fontFamily="mono"
                  px={2.5}
                  py={1}
                  borderRadius="full"
                  bg={`${agent.color}/10`}
                  border="1px solid"
                  borderColor={`${agent.color}/25`}
                  whiteSpace="nowrap"
                >
                  {businessUnitName}
                </Text>
              )}
            </HStack>
            <Text fontSize="2xs" color="fg.muted" fontFamily="mono" textTransform="uppercase" letterSpacing="0.1em" lineHeight="1">
              {agent.role}
            </Text>
          </VStack>
        </HStack>
        <Button
          variant="ghost"
          size="xs"
          color="fg.subtle"
          fontFamily="mono"
          _hover={{ color: 'accent.teal' }}
          aria-label="Switch agent"
          onClick={onSwitchAgent}
        >
          <Icon as={LuRefreshCw} boxSize={3.5} mr={1.5} />
          Switch agent
        </Button>
      </Flex>

      {/* ─── Proactive intelligence deck (hero) ─────────────────────────── */}
      <Box
        className="mx-deck mx-agent-card"
        borderRadius="2xl"
        border="1px solid"
        borderColor="border.default"
        bg="bg.panel"
        overflow="hidden"
      >
        {/* Top hairline — agent accent fading out */}
        <Box
          h="2px"
          bgGradient="to-r"
          gradientFrom={agent.color}
          gradientVia="accent.teal"
          gradientTo="transparent"
          opacity={0.8}
        />
        <VStack align="stretch" gap={4} p={{ base: 4, md: 5 }} position="relative">
          {/* Deck header */}
          <Flex justify="space-between" align="start" gap={3} flexWrap="wrap">
            <VStack align="start" gap={2}>
              <HStack gap={2}>
                {/* Live radar dot */}
                <Box position="relative" boxSize="9px" flexShrink={0}>
                  <Box position="absolute" inset={0} borderRadius="full" bg="accent.teal" />
                  <Box
                    className="mx-radar"
                    position="absolute"
                    inset={0}
                    borderRadius="full"
                    border="1.5px solid"
                    borderColor="accent.teal"
                  />
                </Box>
                <Text
                  fontSize="2xs"
                  fontWeight="700"
                  color="accent.teal"
                  textTransform="uppercase"
                  letterSpacing="0.2em"
                  fontFamily="mono"
                >
                  Proactive Intelligence
                </Text>
              </HStack>
              <Heading fontSize="xl" fontWeight="800" fontFamily="mono" color="fg.default" letterSpacing="-0.01em" lineHeight="1.2">
                I went ahead and looked, {firstName}.
                <br />
                {flagged} {flagged === 1 ? 'thing' : 'things'} stand out{businessUnitName ? ` at ${businessUnitName}` : ''}.
              </Heading>
            </VStack>
            {/* Telemetry readout */}
            <VStack align="end" gap={1} display={{ base: 'none', sm: 'flex' }}>
              <HStack gap={1.5}>
                <Icon as={LuActivity} boxSize={3} color="fg.subtle" />
                <Text fontSize="2xs" color="fg.subtle" fontFamily="mono" letterSpacing="0.05em">
                  SCAN <Text as="span" className="mx-blink" color="accent.teal">●</Text> 06:42 LOCAL
                </Text>
              </HStack>
              <Text fontSize="2xs" color="fg.subtle" fontFamily="mono" letterSpacing="0.05em">
                18 SIGNALS · {flagged} FLAGGED
              </Text>
            </VStack>
          </Flex>

          {/* Insight cards */}
          <SimpleGrid columns={{ base: 1, lg: 3 }} gap={3}>
            {agent.proactiveInsights.map((insight, idx) => (
              <InsightCard
                key={idx}
                insight={insight}
                index={idx}
                onClick={() => onPromptClick(insight.prompt)}
              />
            ))}
          </SimpleGrid>
        </VStack>
      </Box>

      {/* ─── Recommended threads (secondary) ────────────────────────────── */}
      <VStack align="stretch" gap={3}>
        <HStack gap={2.5} align="center">
          <Text
            fontSize="2xs"
            fontWeight="700"
            color="fg.subtle"
            textTransform="uppercase"
            letterSpacing="0.18em"
            fontFamily="mono"
            whiteSpace="nowrap"
          >
            Or pick a thread
          </Text>
          <Box flex="1" h="1px" bg="border.muted" />
        </HStack>

        <SimpleGrid columns={{ base: 1, md: 2 }} gap={3}>
          {agent.recommendedActions.map((action, idx) => {
            const tag = TAG_META[action.tag];
            return (
              <HStack
                key={idx}
                className="mx-q-row mx-agent-card"
                style={{ animationDelay: `${idx * 50}ms` }}
                align="center"
                gap={2.5}
                px={3}
                py={2.5}
                borderRadius="lg"
                border="1px solid"
                borderColor="border.default"
                bg="bg.panel"
                cursor="pointer"
                transition="border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease"
                _hover={{ borderColor: `${tag.color}/50`, boxShadow: 'sm', transform: 'translateY(-1px)' }}
                aria-label={`Ask: ${action.title}`}
                onClick={() => onPromptClick(action.title)}
              >
                <Text
                  fontSize="2xs"
                  fontWeight="700"
                  color={tag.color}
                  textTransform="uppercase"
                  letterSpacing="0.1em"
                  fontFamily="mono"
                  flexShrink={0}
                  px={1.5}
                  py={0.5}
                  borderRadius="sm"
                  bg={`${tag.color}/10`}
                >
                  {tag.label}
                </Text>
                <Text fontSize="sm" fontWeight="500" color="fg.default" fontFamily="mono" lineHeight="1.35" flex="1" minW={0}>
                  {action.title}
                </Text>
                <Icon className="mx-q-arrow" as={LuArrowRight} boxSize={3.5} color={tag.color} flexShrink={0} />
              </HStack>
            );
          })}
        </SimpleGrid>
      </VStack>
    </VStack>
  );
}

// A single proactive finding — metric readout + delta + rationale + dig-in CTA.
function InsightCard({
  insight,
  index,
  onClick,
}: {
  insight: ProactiveInsight;
  index: number;
  onClick: () => void;
}) {
  const sev = SEVERITY_META[insight.severity];
  const DeltaIcon = insight.deltaDir === 'up' ? LuArrowUpRight : insight.deltaDir === 'down' ? LuArrowDownRight : LuMinus;
  return (
    <Flex
      className="mx-insight mx-agent-card"
      style={{ animationDelay: `${index * 90}ms` }}
      direction="column"
      position="relative"
      borderRadius="xl"
      border="1px solid"
      borderColor="border.default"
      bg="bg.canvas"
      overflow="hidden"
      cursor="pointer"
      transition="border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease"
      _hover={{ borderColor: `${sev.color}/55`, boxShadow: 'md', transform: 'translateY(-3px)' }}
      aria-label={`Dig into: ${insight.headline}`}
      onClick={onClick}
    >
      {/* Severity-tinted wash, concentrated at the top-right */}
      <Box
        position="absolute"
        inset={0}
        bgGradient="to-bl"
        gradientFrom={`${sev.color}/10`}
        gradientTo="transparent"
        pointerEvents="none"
      />
      {/* Oversized watermark glyph for depth */}
      <Icon
        as={sev.icon}
        position="absolute"
        top={-4}
        right={-3}
        boxSize={24}
        color={sev.color}
        opacity={0.07}
        pointerEvents="none"
        transform="rotate(-8deg)"
      />

      <VStack align="stretch" gap={2} p={3} flex="1" position="relative">
        {/* Hero metric + delta, with severity label on the right */}
        <HStack justify="space-between" align="center" gap={2}>
          <HStack align="center" gap={2}>
            <Text fontSize="2xl" fontWeight="800" color="fg.default" fontFamily="mono" letterSpacing="-0.03em" lineHeight="1">
              {insight.value}
            </Text>
            <HStack
              gap={1}
              align="center"
              color={sev.color}
              bg={`${sev.color}/12`}
              border="1px solid"
              borderColor={`${sev.color}/22`}
              px={1.5}
              py={0.5}
              borderRadius="full"
              flexShrink={0}
            >
              <Icon as={DeltaIcon} boxSize={3} />
              <Text fontSize="2xs" fontWeight="700" fontFamily="mono" whiteSpace="nowrap" letterSpacing="0.02em">
                {insight.delta}
              </Text>
            </HStack>
          </HStack>
          <HStack gap={1} align="center" flexShrink={0}>
            <Icon as={sev.icon} boxSize={3} color={sev.color} />
            <Text
              fontSize="2xs"
              fontWeight="700"
              color={sev.color}
              textTransform="uppercase"
              letterSpacing="0.12em"
              fontFamily="mono"
              whiteSpace="nowrap"
            >
              {sev.label}
            </Text>
          </HStack>
        </HStack>

        {/* Finding */}
        <Text fontSize="sm" fontWeight="600" color="fg.default" fontFamily="mono" lineHeight="1.4">
          {insight.headline}
        </Text>
        <Text fontSize="2xs" color="fg.muted" fontFamily="mono" lineHeight="1.5">
          {insight.detail}
        </Text>

        {/* Dig-in CTA */}
        <HStack gap={1.5} mt="auto" pt={1} color={sev.color}>
          <Icon className="mx-dig" as={LuCornerDownRight} boxSize={3.5} />
          <Text className="mx-dig" fontSize="2xs" fontWeight="700" fontFamily="mono" textTransform="uppercase" letterSpacing="0.1em">
            Dig into this
          </Text>
        </HStack>
      </VStack>
    </Flex>
  );
}

const ExampleQuestions = memo(ExampleQuestionsImpl);
export default ExampleQuestions;
