'use client';

import { useState, useEffect } from 'react';
import { Box, VStack, HStack, Text, Heading, Button, Textarea, Icon } from '@chakra-ui/react';
import { LuSparkles } from 'react-icons/lu';
import { cursorBlinkKeyframes } from '@/lib/ui/animations';
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
    placeholder: 'e.g., E-commerce DB — orders, customers, products',
  },
  {
    key: 'keyMetrics' as const,
    label: 'What are the key metrics or KPIs you track?',
    placeholder: 'e.g., Revenue, conversion rate, avg order value',
  },
  {
    key: 'dashboardPreference' as const,
    label: 'What would you like to see in the dashboard?',
    placeholder: 'e.g., Revenue trends, top products, customer segments',
  },
];

export default function StepQuestionnaire({ onComplete, greeting }: StepQuestionnaireProps) {
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
          We&apos;ll use this to generate context and a starter dashboard.
        </Text>
      </Box>

      {/* Questions */}
      <VStack gap={4} align="stretch">
        {QUESTIONS.map(({ key, label, placeholder }) => {
          const isAgent = agentKeys.has(key);
          return (
            <Box key={key}>
              <HStack justify="space-between" mb={1.5}>
                <Text fontSize="sm" fontWeight="400" color="fg.default" fontFamily="mono">
                  {label}
                </Text>
                <HStack
                  as="button"
                  gap={1}
                  cursor="pointer"
                  onClick={() => {
                    setAgentKeys(prev => {
                      const next = new Set(prev);
                      if (next.has(key)) { next.delete(key); } else { next.add(key); }
                      return next;
                    });
                    if (!isAgent) handleChange(key, '');
                  }}
                  px={2}
                  py={0.5}
                  borderRadius="md"
                  bg={isAgent ? 'accent.teal/10' : 'transparent'}
                  border="1px solid"
                  borderColor={isAgent ? 'accent.teal/30' : 'transparent'}
                  _hover={{ bg: 'accent.teal/10' }}
                  transition="all 0.15s"
                >
                  <Icon as={LuSparkles} boxSize={3.5} color="accent.teal" />
                  <Text fontSize="xs" fontFamily="mono" color="accent.teal">
                    let agent figure out
                  </Text>
                </HStack>
              </HStack>
              {isAgent ? (
                <Box
                  px={3}
                  py={2.5}
                  borderRadius="md"
                  border="1px dashed"
                  borderColor="accent.teal"
                  bg="accent.teal/5"
                >
                  <HStack gap={1.5}>
                    <Icon as={LuSparkles} boxSize={3.5} color="accent.teal" />
                    <Text fontSize="sm" fontFamily="mono" color="accent.teal">
                      The agent will figure this out
                    </Text>
                  </HStack>
                </Box>
              ) : (
                <Textarea
                  aria-label={label}
                  value={answers[key]}
                  onChange={(e) => handleChange(key, e.target.value)}
                  placeholder={placeholder}
                  fontFamily="mono"
                  fontSize="sm"
                  rows={2}
                  resize="none"
                />
              )}
            </Box>
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
