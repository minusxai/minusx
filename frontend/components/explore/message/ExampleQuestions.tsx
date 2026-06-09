'use client';

import { memo, useMemo } from 'react';
import { VStack, Box, HStack, Heading, Text, Icon, Grid, GridItem, SimpleGrid, Flex } from '@chakra-ui/react';
import { LuTrendingUp, LuWallet, LuMegaphone, LuArrowRight } from 'react-icons/lu';
import { useAppSelector } from '@/store/hooks';
import { selectEffectiveUser } from '@/store/authSlice';
import { useConfigs } from '@/lib/hooks/useConfigs';

interface ExampleQuestionsProps {
  onPromptClick: (prompt: string) => void;
  container?: 'page' | 'sidebar';
  colSpan: any;
  colStart: any;
}

// Scoped keyframes + hover reveal for the agent cards. Injected once; the
// entrance animation lives on an OUTER wrapper so its `forwards` fill never
// fights the inner card's :hover transform (animation fills win the cascade).
const AGENT_CARD_STYLES = `
@keyframes mxAgentCardIn {
  from { opacity: 0; transform: translateY(14px) scale(0.985); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes mxAgentPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.45; transform: scale(0.82); }
}
.mx-agent-card { opacity: 0; animation: mxAgentCardIn 0.55s cubic-bezier(0.22, 0.8, 0.28, 1) forwards; }
.mx-agent-dot { animation: mxAgentPulse 2.4s ease-in-out infinite; }
.mx-q-arrow { opacity: 0; transform: translateX(-6px); transition: opacity 0.2s ease, transform 0.2s ease; }
.mx-q-row:hover .mx-q-arrow { opacity: 1; transform: translateX(0); }
@media (prefers-reduced-motion: reduce) {
  .mx-agent-card, .mx-agent-dot { animation: none; opacity: 1; }
}
`;

const greetings = [
  (name: string) => `Hi ${name}, what would you like to explore today?`,
  (name: string) => `Hey ${name}, ready to dig into some data?`,
  (name: string) => `Welcome back ${name}! What can I help you find?`,
  (name: string) => `What's on your mind today, ${name}?`,
];

const agents = [
  {
    icon: LuTrendingUp,
    name: "CEO Agent",
    role: "Strategy & Growth",
    color: "accent.teal",
    questions: [
      "How is overall revenue trending this quarter?",
      "Which business segments are growing fastest?",
      "What are our biggest risks right now?",
    ],
  },
  {
    icon: LuWallet,
    name: "CFO Agent",
    role: "Finance & Margins",
    color: "accent.success",
    questions: [
      "What's our current burn rate and runway?",
      "How are gross margins trending by product?",
      "Where are costs increasing fastest?",
    ],
  },
  {
    icon: LuMegaphone,
    name: "CMO Agent",
    role: "Marketing & Acquisition",
    color: "accent.secondary",
    questions: [
      "Which channels drive the best CAC?",
      "How is our conversion funnel performing?",
      "What's our customer retention by cohort?",
    ],
  },
];

function ExampleQuestionsImpl({ onPromptClick, container, colSpan, colStart }: ExampleQuestionsProps) {
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  const user = useAppSelector(selectEffectiveUser);
  const { config } = useConfigs();
  const agentName = config.branding.agentName;
  const isMinusx = agentName.toLowerCase() === 'minusx';
  const firstName = user?.name?.split(' ')[0].split('@')[0] || 'there';
  // greetings is module-level and stable; greeting is intentionally
  // re-randomised on firstName change only — Math.random() in useMemo is
  // the desired behaviour.
  const greeting = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity
    const index = Math.floor(Math.random() * greetings.length);
    return greetings[index](firstName);
  }, [firstName]);

  // Widen the layout for the 3-agent grid so the columns have room (the
  // narrow chat colSpan/colStart is meant for the single-column input below).
  const wideColSpan = container === 'sidebar' ? 12 : { base: 12, md: 10, lg: 10 };
  const wideColStart = container === 'sidebar' ? 1 : { base: 1, md: 2, lg: 2 };

  return (
    <Grid templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }} gap={2} w="100%">
      <GridItem colSpan={wideColSpan} colStart={wideColStart}>
        <VStack gap={6} align="center" justify="center" flex="1" py={6}>
          {/* Welcome Header */}
          <VStack gap={2}>
            {isMinusx ? (
              <Box
                position="relative"
                borderRadius="lg"
                overflow="hidden"
                p={4}
              >
                <Box
                  position="absolute"
                  inset={0}
                  pointerEvents="none"
                />
                <img
                  src={colorMode === 'light' ? '/minusx_explore_dark.svg' : '/minusx_explore.svg'}
                  alt="minusx explore"
                  style={{ width: '380px', height: '160px', position: 'relative' }}
                />
              </Box>
            ) : (
              <>
                <Box
                  p={3}
                  borderRadius="full"
                  bg="accent.teal/10"
                  border="2px solid"
                  borderColor="accent.teal/30"
                >
                  <Box
                    aria-label="Workspace logo"
                    role="img"
                    boxSize={6}
                    flexShrink={0}
                  />
                </Box>
                <Heading
                  fontSize="xl"
                  fontWeight="800"
                  fontFamily="mono"
                  color="fg.default"
                  letterSpacing="-0.02em"
                >
                  Ask {agentName} anything
                </Heading>
              </>
            )}
            <Text
              color="fg.muted"
              fontSize="sm"
              fontFamily="mono"
            //   textAlign="center"
            >
              {greeting}
            </Text>
          </VStack>

          {/* Agent Verticals */}
            <Box width="100%">
              <style>{AGENT_CARD_STYLES}</style>

              {/* Eyebrow divider */}
              <HStack gap={3} w="100%" align="center" mb={4}>
                <Box flex="1" h="1px" bg="border.default" />
                <Text
                  fontSize="2xs"
                  fontWeight="700"
                  color="fg.subtle"
                  textTransform="uppercase"
                  letterSpacing="0.18em"
                  fontFamily="mono"
                  whiteSpace="nowrap"
                >
                  Your AI Agents · pick a starting point
                </Text>
                <Box flex="1" h="1px" bg="border.default" />
              </HStack>

              <SimpleGrid columns={{ base: 1, md: 3 }} gap={4} alignItems="stretch">
                {agents.map((agent, index) => (
                  <Box
                    key={agent.name}
                    className="mx-agent-card"
                    style={{ animationDelay: `${index * 110}ms` }}
                    h="100%"
                  >
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
                      _hover={{
                        borderColor: `${agent.color}/50`,
                        boxShadow: 'lg',
                        transform: 'translateY(-3px)',
                      }}
                    >
                      {/* Soft accent glow at the top of the card */}
                      <Box
                        position="absolute"
                        top="-40%"
                        left="50%"
                        transform="translateX(-50%)"
                        w="120%"
                        h="80%"
                        bg={`${agent.color}/10`}
                        filter="blur(48px)"
                        pointerEvents="none"
                        opacity={0.7}
                      />

                      {/* Header */}
                      <HStack gap={2.5} p={4} pb={3} position="relative">
                        <Flex
                          align="center"
                          justify="center"
                          boxSize={9}
                          borderRadius="lg"
                          bg={`${agent.color}/12`}
                          border="1px solid"
                          borderColor={`${agent.color}/25`}
                          flexShrink={0}
                        >
                          <Icon as={agent.icon} boxSize={4.5} color={agent.color} />
                        </Flex>
                        <VStack gap={0.5} align="start" flex="1" minW={0}>
                          <Text
                            fontSize="sm"
                            fontWeight="700"
                            color="fg.default"
                            fontFamily="mono"
                            letterSpacing="-0.01em"
                            lineHeight="1.1"
                          >
                            {agent.name}
                          </Text>
                          <HStack gap={1.5} align="center">
                            <Box
                              className="mx-agent-dot"
                              boxSize="6px"
                              borderRadius="full"
                              bg={agent.color}
                              flexShrink={0}
                            />
                            <Text
                              fontSize="2xs"
                              fontWeight="600"
                              color="fg.muted"
                              textTransform="uppercase"
                              letterSpacing="0.06em"
                              fontFamily="mono"
                              truncate
                            >
                              {agent.role}
                            </Text>
                          </HStack>
                        </VStack>
                      </HStack>

                      <Box h="1px" bg="border.default" mx={3} />

                      {/* Questions */}
                      <VStack gap={0.5} align="stretch" p={2} flex="1">
                        {agent.questions.map((question, qIndex) => (
                          <HStack
                            key={qIndex}
                            className="mx-q-row"
                            gap={2}
                            align="center"
                            justify="space-between"
                            px={2.5}
                            py={2.5}
                            borderRadius="lg"
                            cursor="pointer"
                            transition="background 0.18s ease, padding-left 0.18s ease"
                            onClick={() => onPromptClick(question)}
                            _hover={{ bg: `${agent.color}/8`, pl: 3.5 }}
                          >
                            <Text
                              fontSize="xs"
                              fontWeight="500"
                              color="fg.default"
                              fontFamily="mono"
                              lineHeight="1.45"
                            >
                              {question}
                            </Text>
                            <Icon
                              className="mx-q-arrow"
                              as={LuArrowRight}
                              boxSize={3.5}
                              color={agent.color}
                              flexShrink={0}
                            />
                          </HStack>
                        ))}
                      </VStack>
                    </Flex>
                  </Box>
                ))}
              </SimpleGrid>
            </Box>
        </VStack>
      </GridItem>
    </Grid>
  );
}

// Memoized: ChatInterface used to re-render on every streaming chunk (cascading
// down into ~15 Box renders here, 46+ times per 16s in the original trace).
// Even after the bag-selector fix in ChatInterface, this guards against future
// regressions where the parent re-renders for an internal reason (scroll state,
// container resize, …) — the props are stable, so React skips the subtree.
const ExampleQuestions = memo(ExampleQuestionsImpl);
export default ExampleQuestions;
