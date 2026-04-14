'use client';

import { useState, useEffect, useMemo } from 'react';
import { Box, HStack, Text, Icon, IconButton } from '@chakra-ui/react';
import { LuSparkles, LuSquare } from 'react-icons/lu';
import { thinkingPhrases as defaultThinkingPhrases } from './message/thinkingPhrases';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { sparkleKeyframes } from '@/lib/ui/animations';

const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface ThinkingIndicatorProps {
  waitingForInput?: boolean;
  onStop?: () => void;
}

export default function ThinkingIndicator({ waitingForInput = false, onStop }: ThinkingIndicatorProps) {
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
    }, 5000);

    return () => clearInterval(interval);
  }, [waitingForInput, thinkingPhrases.length]);

  const currentPhrase = waitingForInput ? 'Waiting for your input' : thinkingPhrases[phraseIndex];

  const [brailleFrame, setBrailleFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setBrailleFrame((prev) => (prev + 1) % BRAILLE_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      <style>{sparkleKeyframes}</style>
      <Box px={3} py={2} bg="bg.muted" borderRadius="md" mb={1}>
        <HStack gap={2.5} justify="space-between">
          <HStack gap={2.5}>
            <Box css={{ animation: 'sparkle 2s ease-in-out infinite' }}>
              <Icon as={LuSparkles} boxSize={4} color="accent.teal" />
            </Box>
            <HStack gap={1.5}>
              <Text color="fg.muted" fontSize="sm" fontFamily="mono">
                {currentPhrase}
              </Text>
              <Text color="accent.teal" fontSize="sm" fontFamily="mono" flexShrink={0} w="1ch">
                {BRAILLE_FRAMES[brailleFrame]}
              </Text>
            </HStack>
          </HStack>
          {onStop && (
            <IconButton
              aria-label="Stop agent"
              onClick={onStop}
              bg="accent.danger"
              color="white"
              _hover={{ bg: 'accent.danger', opacity: 0.9 }}
              size="xs"
              borderRadius="md"
              flexShrink={0}
              px={2}
            >
              Stop
              <Icon as={LuSquare} boxSize={3} fill="white"/>
            </IconButton>
          )}
        </HStack>
      </Box>
    </>
  );
}
