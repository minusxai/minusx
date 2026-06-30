'use client';

import { useState, useEffect } from 'react';
import { Box, VStack, HStack, Text, Heading, Button, Textarea, Icon } from '@chakra-ui/react';
import { LuSparkles, LuX } from 'react-icons/lu';
import { cursorBlinkKeyframes } from '@/lib/ui/animations';
import { useConfigs } from '@/lib/hooks/useConfigs';
import type { QuestionnaireAnswers } from '../ConnectionWizardTypes';

const TYPEWRITER_SPEED = 35;

interface StepQuestionnaireProps {
  onComplete: (answers: QuestionnaireAnswers) => void;
  greeting?: string;
}

const QUESTIONS = [
  {
    key: 'datasetDescription' as const,
    label: 'What is this dataset about?',
    placeholder: 'orders, customers, products…',
    autoLabel: (agent: string) => `${agent} will infer this from your schema`,
  },
  {
    key: 'keyMetrics' as const,
    label: 'Key metrics or KPIs you track',
    placeholder: 'revenue, conversion, AOV…',
    autoLabel: (agent: string) => `${agent} will derive these from your tables`,
  },
  {
    key: 'dashboardPreference' as const,
    label: 'What to show in the dashboard',
    placeholder: 'trends, top products, segments…',
    autoLabel: (agent: string) => `${agent} will design this for you`,
  },
];

export default function StepQuestionnaire({ onComplete, greeting }: StepQuestionnaireProps) {
  const { config } = useConfigs();
  const agentName = config.branding.agentName;
  const [answers, setAnswers] = useState<QuestionnaireAnswers>({
    datasetDescription: '',
    keyMetrics: '',
    dashboardPreference: '',
  });
  const [agentKeys, setAgentKeys] = useState<Set<keyof QuestionnaireAnswers>>(new Set());

  // Typewriter effect for greeting
  const [displayedText, setDisplayedText] = useState('');
  const [typingDone, setTypingDone] = useState(!greeting);

  useEffect(() => {
    if (!greeting) return;
    let i = 0;
    setDisplayedText('');
    setTypingDone(false);
    const interval = setInterval(() => {
      i++;
      setDisplayedText(greeting.slice(0, i));
      if (i >= greeting.length) {
        clearInterval(interval);
        setTypingDone(true);
      }
    }, TYPEWRITER_SPEED);
    return () => clearInterval(interval);
  }, [greeting]);

  const handleChange = (key: keyof QuestionnaireAnswers, value: string) => {
    setAnswers(prev => ({ ...prev, [key]: value }));
  };

  const canContinue = answers.datasetDescription.trim().length > 0 || agentKeys.has('datasetDescription');

  return (
    <VStack gap={6} align="stretch" minH="400px">
      {greeting && <style>{cursorBlinkKeyframes}</style>}

      {/* Header */}
      <Box>
        {greeting ? (
          <Heading
            fontSize="2xl"
            fontFamily="mono"
            fontWeight="400"
            mb={1}
            letterSpacing="-0.02em"
          >
            {displayedText}
            {!typingDone && (
              <Box
                as="span"
                display="inline-block"
                w="2px"
                h="1em"
                bg="accent.teal"
                ml="2px"
                verticalAlign="text-bottom"
                css={{ animation: 'cursorBlink 0.8s step-end infinite' }}
              />
            )}
          </Heading>
        ) : (
          <Heading size="md" fontFamily="mono" fontWeight="500" mb={1}>
            Tell us about your data
          </Heading>
        )}
        <Text color="fg.muted" fontSize="sm">
          Answer what you know. {agentName} fills in the rest.
        </Text>
      </Box>

      {/* Questions — numbered rail; the "let agent figure it out" affordance lives
          inside each empty field, and the field collapses to a quiet teal line when chosen. */}
      <VStack gap={4} align="stretch">
        {QUESTIONS.map(({ key, label, placeholder, autoLabel }, idx) => {
          const isAgent = agentKeys.has(key);
          const isEmpty = answers[key].trim().length === 0;
          const toggleAgent = () => {
            setAgentKeys(prev => {
              const next = new Set(prev);
              if (next.has(key)) { next.delete(key); } else { next.add(key); }
              return next;
            });
            if (!isAgent) handleChange(key, '');
          };
          return (
            <HStack key={key} align="flex-start" gap={3.5}>
              {/* Numbered rail */}
              <Text
                fontFamily="mono"
                fontSize="sm"
                fontWeight="600"
                color={isAgent ? 'accent.teal' : 'fg.subtle'}
                lineHeight="1.4"
                pt="3px"
                w="18px"
                flexShrink={0}
                transition="color 0.2s"
              >
                {String(idx + 1).padStart(2, '0')}
              </Text>

              <Box flex={1} minW={0}>
                <Text fontSize="sm" fontWeight="500" color="fg.default" fontFamily="mono" mb={2} truncate>
                  {label}
                </Text>

                {isAgent ? (
                  <HStack
                    justify="space-between"
                    gap={2}
                    px={3}
                    h="40px"
                    borderRadius="md"
                    bg="accent.teal/8"
                  >
                    <HStack gap={2} minW={0}>
                      <Icon as={LuSparkles} boxSize={3.5} color="accent.teal" />
                      <Text fontSize="xs" fontFamily="mono" color="accent.teal" truncate>
                        {autoLabel(agentName)}
                      </Text>
                    </HStack>
                    <Box
                      as="button"
                      aria-label={`Write it myself: ${label}`}
                      onClick={toggleAgent}
                      cursor="pointer"
                      color="accent.teal"
                      opacity={0.7}
                      _hover={{ opacity: 1 }}
                      flexShrink={0}
                      lineHeight="0"
                      transition="opacity 0.15s"
                    >
                      <Icon as={LuX} boxSize={3.5} />
                    </Box>
                  </HStack>
                ) : (
                  <Box position="relative">
                    <Textarea
                      aria-label={label}
                      value={answers[key]}
                      onChange={(e) => handleChange(key, e.target.value)}
                      placeholder={placeholder}
                      fontFamily="mono"
                      fontSize="sm"
                      autoresize
                      rows={2}
                      maxH="180px"
                      resize="none"
                      overflowY="auto"
                      bg="bg.canvas"
                      _focus={{ borderColor: 'accent.teal', boxShadow: '0 0 0 1px var(--chakra-colors-accent-teal)' }}
                    />
                    {isEmpty && (
                      <HStack
                        as="button"
                        aria-label={`Let agent figure it out: ${label}`}
                        onClick={toggleAgent}
                        cursor="pointer"
                        position="absolute"
                        bottom="8px"
                        right="8px"
                        gap={1.5}
                        pl={2.5}
                        pr={3}
                        py={1.5}
                        my={1}
                        borderRadius="full"
                        bg="accent.teal/10"
                        color="accent.teal"
                        _hover={{ bg: 'accent.teal/15' }}
                        transition="background 0.15s"
                      >
                        <Icon as={LuSparkles} boxSize={3} />
                        <Text fontSize="xs" fontFamily="mono" fontWeight="500" lineHeight="1">
                          let agent figure it out
                        </Text>
                      </HStack>
                    )}
                  </Box>
                )}
              </Box>
            </HStack>
          );
        })}
      </VStack>

      {/* Spacer */}
      <Box flex={1} />

      {/* Footer */}
      <HStack justify="flex-end">
        <Button
          aria-label="Continue to documentation step"
          bg="accent.teal"
          color="white"
          _hover={{ opacity: 0.9 }}
          size="sm"
          fontFamily="mono"
          onClick={() => {
            const finalAnswers = { ...answers };
            for (const key of agentKeys) {
              finalAnswers[key] = '[let the agent figure out]';
            }
            onComplete(finalAnswers);
          }}
          disabled={!canContinue}
        >
          Continue &rarr;
        </Button>
      </HStack>
    </VStack>
  );
}
