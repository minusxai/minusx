'use client';

import { VStack, Text, Progress } from '@chakra-ui/react';
import { useAgentProgress, getProgressMessage } from '../useAgentProgress';

const SAVE_TAU = 9; // ~80% at 15s

export default function SaveProgressBar() {
  const progress = useAgentProgress(true, false, SAVE_TAU);
  return (
    <VStack gap={2} align="stretch" pt={2}>
      <style>{`@keyframes saveShimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`}</style>
      <Text fontSize="xs" fontFamily="mono" color="accent.teal">
        {getProgressMessage(progress, [
          [0, 'Saving context...'],
          [30, 'Building knowledge base...'],
          [60, 'Syncing schema metadata...'],
          [80, 'Almost there...'],
        ])}
      </Text>
      <Progress.Root size="sm" value={progress} colorPalette="teal">
        <Progress.Track borderRadius="full" overflow="hidden">
          <Progress.Range
            style={{ transition: 'width 0.4s ease-out' }}
            css={{
              position: 'relative',
              '&::after': {
                content: '""',
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
                animation: 'saveShimmer 1.5s ease-in-out infinite',
              },
            }}
          />
        </Progress.Track>
      </Progress.Root>
    </VStack>
  );
}
