'use client';

import { memo, useState } from 'react';
import { VStack, Box, HStack, Heading, Text, Icon, Grid, GridItem, SimpleGrid, Flex, Button } from '@chakra-ui/react';
import { LuArrowRight, LuArrowLeft, LuCheck, LuRefreshCw } from 'react-icons/lu';
import { useAppSelector } from '@/store/hooks';
import { selectEffectiveUser } from '@/store/authSlice';
import {
  DEMO_AGENTS,
  BUSINESS_UNITS,
  DEFAULT_AGENT_SELECTION,
  getDemoAgent,
  getBusinessUnit,
  TAG_META,
  type DemoAgent,
  type AgentSelection,
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
.mx-agent-card { opacity: 0; animation: mxAgentCardIn 0.5s cubic-bezier(0.22, 0.8, 0.28, 1) forwards; }
.mx-agent-dot { animation: mxAgentPulse 2.4s ease-in-out infinite; }
.mx-q-arrow { opacity: 0; transform: translateX(-6px); transition: opacity 0.2s ease, transform 0.2s ease; }
.mx-q-row:hover .mx-q-arrow { opacity: 1; transform: translateX(0); }
@media (prefers-reduced-motion: reduce) {
  .mx-agent-card, .mx-agent-dot { animation: none; opacity: 1; }
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

  // Widen the layout for the multi-column grids.
  const wideColSpan = container === 'sidebar' ? 12 : { base: 12, md: 10, lg: 10 };
  const wideColStart = container === 'sidebar' ? 1 : { base: 1, md: 2, lg: 2 };

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
            <PickStep firstName={firstName} onLaunch={handleLaunch} />
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
// Step 1 — Choose your agent
// ─────────────────────────────────────────────────────────────────────────────
function PickStep({ firstName, onLaunch }: { firstName: string; onLaunch: (agent: DemoAgent) => void }) {
  return (
    <VStack gap={6} align="stretch">
      <VStack gap={1.5} align="center" textAlign="center">
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
        <Text color="fg.muted" fontSize="sm" fontFamily="mono" maxW="2xl">
          Hi {firstName} — each agent is briefed on the latest internal data and continuously
          benchmarks against industry signals. Pick the lens you need today.
        </Text>
      </VStack>

      <SimpleGrid columns={{ base: 1, md: 3 }} gap={4} alignItems="stretch">
        {DEMO_AGENTS.map((agent, index) => (
          <Box key={agent.id} className="mx-agent-card" style={{ animationDelay: `${index * 100}ms` }} h="100%">
            <Flex
              direction="column"
              h="100%"
              position="relative"
              borderRadius="xl"
              border="1px solid"
              borderColor="border.default"
              bg="bg.panel"
              overflow="hidden"
              transition="border-color 0.25s ease, box-shadow 0.25s ease, transform 0.25s ease"
              _hover={{ borderColor: 'border.emphasized', boxShadow: 'md', transform: 'translateY(-2px)' }}
            >
              <VStack align="stretch" gap={3} p={4} flex="1" position="relative">
                <HStack gap={3} align="start">
                  <Flex
                    align="center"
                    justify="center"
                    boxSize={10}
                    borderRadius="lg"
                    bg={`${agent.color}/12`}
                    border="1px solid"
                    borderColor={`${agent.color}/25`}
                    flexShrink={0}
                  >
                    <Icon as={agent.icon} boxSize={5} color={agent.color} />
                  </Flex>
                  <VStack gap={0.5} align="start" flex="1" minW={0}>
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
                    <Text fontSize="md" fontWeight="700" color="fg.default" fontFamily="mono" lineHeight="1.1">
                      {agent.name}
                    </Text>
                  </VStack>
                </HStack>

                <Text fontSize="sm" color="fg.muted" fontFamily="mono" lineHeight="1.55">
                  {agent.description}
                </Text>

                <HStack gap={1.5} flexWrap="wrap" mt="auto" pt={1}>
                  {agent.topics.map((topic) => (
                    <Text
                      key={topic}
                      fontSize="2xs"
                      fontWeight="600"
                      color="fg.muted"
                      fontFamily="mono"
                      px={2}
                      py={0.5}
                      borderRadius="full"
                      bg="bg.muted"
                      border="1px solid"
                      borderColor="border.muted"
                    >
                      {topic}
                    </Text>
                  ))}
                </HStack>
              </VStack>

              <Box p={3} pt={0}>
                <Button
                  w="100%"
                  size="sm"
                  variant="outline"
                  bg="bg.canvas"
                  color="fg.default"
                  borderColor="border.emphasized"
                  fontFamily="mono"
                  fontWeight="600"
                  borderRadius="lg"
                  transition="background 0.18s ease, color 0.18s ease, border-color 0.18s ease"
                  _hover={{ bg: 'accent.teal', color: 'white', borderColor: 'accent.teal' }}
                  aria-label={`Launch ${agent.name}`}
                  onClick={() => onLaunch(agent)}
                >
                  Launch {agent.name}
                  <Icon as={LuArrowRight} boxSize={3.5} ml={1.5} />
                </Button>
              </Box>
            </Flex>
          </Box>
        ))}
      </SimpleGrid>
    </VStack>
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
  return (
    <VStack gap={5} align="stretch">
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

      <VStack align="start" gap={1}>
        <Heading fontSize="xl" fontWeight="800" fontFamily="mono" color="fg.default" letterSpacing="-0.01em">
          Welcome back, {firstName}. Here&apos;s where I&apos;d start today.
        </Heading>
        <Text fontSize="sm" color="fg.muted" fontFamily="mono">
          Briefed on this morning&apos;s data{businessUnitName ? ` for ${businessUnitName}` : ''}. Pick a thread to dig in.
        </Text>
      </VStack>

      {/* Recommended action cards */}
      <SimpleGrid columns={{ base: 1, md: 2 }} gap={3}>
        {agent.recommendedActions.map((action, idx) => {
          const tag = TAG_META[action.tag];
          return (
            <Box
              key={idx}
              className="mx-q-row mx-agent-card"
              style={{ animationDelay: `${idx * 60}ms` }}
              p={3.5}
              borderRadius="xl"
              border="1px solid"
              borderColor="border.default"
              bg="bg.panel"
              cursor="pointer"
              transition="border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease"
              _hover={{ borderColor: `${tag.color}/50`, boxShadow: 'md', transform: 'translateY(-2px)' }}
              aria-label={`Ask: ${action.title}`}
              onClick={() => onPromptClick(action.title)}
            >
              <VStack align="stretch" gap={2}>
                <Text
                  fontSize="2xs"
                  fontWeight="700"
                  color={tag.color}
                  textTransform="uppercase"
                  letterSpacing="0.1em"
                  fontFamily="mono"
                  w="fit-content"
                  px={1.5}
                  py={0.5}
                  borderRadius="sm"
                  bg={`${tag.color}/10`}
                >
                  {tag.label}
                </Text>
                <Text fontSize="sm" fontWeight="500" color="fg.default" fontFamily="mono" lineHeight="1.45">
                  {action.title}
                </Text>
                <HStack gap={1.5} justify="space-between">
                  <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">
                    {action.source}
                  </Text>
                  <Icon className="mx-q-arrow" as={LuArrowRight} boxSize={3.5} color={tag.color} flexShrink={0} />
                </HStack>
              </VStack>
            </Box>
          );
        })}
      </SimpleGrid>
    </VStack>
  );
}

const ExampleQuestions = memo(ExampleQuestionsImpl);
export default ExampleQuestions;
