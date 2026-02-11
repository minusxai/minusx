'use client';

import { useState, useEffect, useMemo } from 'react';
import { Box, HStack, Text, Icon } from '@chakra-ui/react';
import { LuSparkles } from 'react-icons/lu';
import { thinkingPhrases as defaultThinkingPhrases } from './message/thinkingPhrases';
import { useConfigs } from '@/lib/hooks/useConfigs';

interface ThinkingIndicatorProps {
  waitingForInput?: boolean;
}

// Use CSS keyframes with Chakra v3
const pulseAnimation = `
  @keyframes pulse {
    0%, 100% { opacity: 0.3; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.2); }
  }
`;

const sparkleAnimation = `
  @keyframes sparkle {
    0%, 100% { transform: rotate(0deg) scale(1); }
    25% { transform: rotate(-10deg) scale(1.1); }
    50% { transform: rotate(10deg) scale(0.9); }
    75% { transform: rotate(-5deg) scale(1.05); }
  }
`;

export default function ThinkingIndicator({ waitingForInput = false }: ThinkingIndicatorProps) {
  const { config } = useConfigs();

  // Use config thinking phrases if present and non-empty, otherwise use defaults
  const thinkingPhrases = useMemo(() => {
    return (config.thinkingPhrases && config.thinkingPhrases.length > 0)
      ? config.thinkingPhrases
      : defaultThinkingPhrases;
  }, [config.thinkingPhrases]);

  const [phraseIndex, setPhraseIndex] = useState(() =>
    Math.floor(Math.random() * thinkingPhrases.length)
  );

  useEffect(() => {
    if (waitingForInput) return; // Don't rotate phrases when waiting for input

    const interval = setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % thinkingPhrases.length);
    }, 10000); // Change phrase every 10 seconds

    return () => clearInterval(interval);
  }, [waitingForInput, thinkingPhrases.length]);

  const currentPhrase = waitingForInput ? 'Waiting for your input' : thinkingPhrases[phraseIndex];
  return (
    <>
      <style>{pulseAnimation}</style>
      <style>{sparkleAnimation}</style>
      <Box p={3} bg="bg.muted" borderRadius="md" my={2}>
        <HStack gap={2.5}>
          <Box
            css={{
              animation: 'sparkle 2s ease-in-out infinite'
            }}
          >
            <Icon as={LuSparkles} boxSize={4} color="accent.teal" />
          </Box>
          <HStack gap={1}>
            <Text color="fg.muted" fontSize="sm" fontFamily="mono">
              {currentPhrase}
            </Text>
            <HStack gap={0.5} minW="20px">
              <Box
                w="4px"
                h="4px"
                borderRadius="full"
                bg="accent.teal"
                css={{
                  animation: 'pulse 1.4s ease-in-out infinite'
                }}
              />
              <Box
                w="4px"
                h="4px"
                borderRadius="full"
                bg="accent.teal"
                css={{
                  animation: 'pulse 1.4s ease-in-out 0.2s infinite'
                }}
              />
              <Box
                w="4px"
                h="4px"
                borderRadius="full"
                bg="accent.teal"
                css={{
                  animation: 'pulse 1.4s ease-in-out 0.4s infinite'
                }}
              />
            </HStack>
          </HStack>
        </HStack>
      </Box>
    </>
  );
}
