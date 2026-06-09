'use client';

import { memo, useMemo } from 'react';
import { VStack, Box, HStack, Heading, Text, Icon, Grid, GridItem, SimpleGrid } from '@chakra-ui/react';
import { LuTrendingUp, LuWallet, LuMegaphone } from 'react-icons/lu';
import { useAppSelector } from '@/store/hooks';
import { selectCompanyName, selectEffectiveUser } from '@/store/authSlice';
import { useConfigs } from '@/lib/hooks/useConfigs';

interface ExampleQuestionsProps {
  onPromptClick: (prompt: string) => void;
  container?: 'page' | 'sidebar';
  colSpan: any;
  colStart: any;
}

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
  const companyName = useAppSelector(selectCompanyName);
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
              <Text
                fontSize="xs"
                fontWeight="700"
                color="fg.subtle"
                textTransform="uppercase"
                letterSpacing="0.05em"
                mb={3}
                fontFamily="mono"
              >
                Ask one of your agents
              </Text>
              <SimpleGrid columns={{ base: 1, md: 3 }} gap={3} alignItems="start">
                {agents.map((agent) => (
                  <VStack key={agent.name} gap={2} align="stretch">
                    {/* Agent header */}
                    <HStack gap={2} px={1}>
                      <Box
                        p={1.5}
                        borderRadius="md"
                        bg={`${agent.color}/10`}
                      >
                        <Icon as={agent.icon} boxSize={4} color={agent.color} />
                      </Box>
                      <VStack gap={0} align="start">
                        <Text
                          fontSize="sm"
                          fontWeight="700"
                          color="fg.default"
                          fontFamily="mono"
                        >
                          {agent.name}
                        </Text>
                        <Text
                          fontSize="2xs"
                          fontWeight="600"
                          color={agent.color}
                          textTransform="uppercase"
                          letterSpacing="0.05em"
                          fontFamily="mono"
                        >
                          {agent.role}
                        </Text>
                      </VStack>
                    </HStack>

                    {/* Agent questions */}
                    {agent.questions.map((question, qIndex) => (
                      <Box
                        key={qIndex}
                        p={3}
                        borderRadius="md"
                        border="1px solid"
                        borderColor="border.default"
                        bg="bg.muted"
                        cursor="pointer"
                        transition="all 0.2s"
                        onClick={() => onPromptClick(question)}
                        _hover={{
                          borderColor: agent.color,
                          bg: `${agent.color}/5`,
                          transform: 'translateY(-2px)'
                        }}
                      >
                        <Text
                          fontSize="sm"
                          fontWeight="500"
                          color="fg.default"
                          fontFamily="mono"
                          lineHeight="1.4"
                        >
                          {question}
                        </Text>
                      </Box>
                    ))}
                  </VStack>
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
