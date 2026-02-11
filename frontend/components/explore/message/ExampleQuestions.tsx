'use client';

import { VStack, Box, HStack, Heading, Text, Icon, Grid, GridItem } from '@chakra-ui/react';
import { LuSparkles, LuSearch, LuChartLine } from 'react-icons/lu';
import { useAppSelector } from '@/store/hooks';
import { selectCompanyName } from '@/store/authSlice';
import { useConfigs } from '@/lib/hooks/useConfigs';

interface ExampleQuestionsProps {
  onPromptClick: (prompt: string) => void;
  container?: 'page' | 'sidebar';
  colSpan: any;
  colStart: any;
}

const suggestedPrompts = [
  {
    icon: LuSparkles,
    text: "What all can you do?",
    category: "Capability"
  },
  {
    icon: LuSearch,
    text: "Describe our main dashboards / questions",
    category: "Search"
  },
  {
    icon: LuChartLine,
    text: "Show me an interesting visualization",
    category: "Analysis"
  }
];

export default function ExampleQuestions({ onPromptClick, container, colSpan, colStart }: ExampleQuestionsProps) {
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  const companyName = useAppSelector(selectCompanyName);
  const { config } = useConfigs();
  const agentName = config.branding.agentName;

  return (
    <Grid templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }} gap={2} w="100%">
      <GridItem colSpan={colSpan} colStart={colStart}>
        <VStack gap={6} align="center" justify="center" flex="1" py={6}>
          {/* Welcome Header */}
          <VStack gap={2}>
            <Box
              p={3}
              borderRadius="full"
              bg="accent.teal/10"
              border="2px solid"
              borderColor="accent.teal/30"
            >
              <Box
                aria-label="Company logo"
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
            <Text
              color="fg.muted"
              fontSize="sm"
              fontFamily="mono"
              textAlign="center"
            >
              Query your data, create visualizations, and discover insights
            </Text>
          </VStack>

          {/* Suggested Prompts Grid */}
            <Box width="100%">
              <Text
                fontSize="xs"
                fontWeight="700"
                color="fg.subtle"
                textTransform="uppercase"
                letterSpacing="0.05em"
                mb={2}
                fontFamily="mono"
              >
                Try these questions
              </Text>
              <VStack gap={2} align="stretch">
                {suggestedPrompts.map((prompt, index) => (
                  <Box
                    key={index}
                    p={3}
                    borderRadius="md"
                    border="1px solid"
                    borderColor="border.default"
                    bg="bg.muted"
                    cursor="pointer"
                    transition="all 0.2s"
                    onClick={() => onPromptClick(prompt.text)}
                    _hover={{
                      borderColor: 'accent.teal',
                      bg: 'accent.teal/5',
                      transform: 'translateX(4px)'
                    }}
                  >
                    <HStack gap={2.5}>
                      <Box
                        p={1.5}
                        borderRadius="md"
                        bg="accent.teal/10"
                      >
                        <Icon as={prompt.icon} boxSize={3.5} color="accent.teal" />
                      </Box>
                      <VStack gap={0} align="start" flex="1">
                        <Text
                          fontSize="2xs"
                          fontWeight="600"
                          color="accent.teal"
                          textTransform="uppercase"
                          letterSpacing="0.05em"
                          fontFamily="mono"
                        >
                          {prompt.category}
                        </Text>
                        <Text
                          fontSize="sm"
                          fontWeight="500"
                          color="fg.default"
                          fontFamily="mono"
                        >
                          {prompt.text}
                        </Text>
                      </VStack>
                    </HStack>
                  </Box>
                ))}
              </VStack>
            </Box>
        </VStack>
      </GridItem>
    </Grid>
  );
}
