'use client';

import { useEffect, useState, useRef } from 'react';
import { Box, VStack, HStack, Text, Heading, Button, Icon } from '@chakra-ui/react';
import { LuSparkles, LuExternalLink } from 'react-icons/lu';
import { useRouter } from '@/lib/navigation/use-navigation';
import { fetchWithCache } from '@/lib/api/fetch-wrapper';
import { pulseKeyframes, sparkleKeyframes } from '@/lib/ui/animations';

interface StepGeneratingProps {
  connectionName: string;
  contextFileId: number;
}

const GENERATING_PHRASES = [
  'Exploring your schema',
  'Discovering patterns',
  'Writing queries',
  'Building visualizations',
  'Putting it all together',
  'Almost there',
];

const PHRASE_INTERVAL = 6000; // 6 seconds per phrase

export default function StepGenerating({ connectionName, contextFileId }: StepGeneratingProps) {
  const router = useRouter();
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [dashboardId, setDashboardId] = useState<number | null>(null);
  const hasStarted = useRef(false);

  // Rotate phrases
  useEffect(() => {
    if (done || error) return;
    const interval = setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % GENERATING_PHRASES.length);
    }, PHRASE_INTERVAL);
    return () => clearInterval(interval);
  }, [done, error]);

  // Trigger dashboard generation
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    let cancelled = false;

    (async () => {
      try {
        const contextPath = contextFileId > 0 ? '/org/context' : null;

        const result = await fetchWithCache('/api/onboarding/generate-dashboard', {
          method: 'POST',
          body: JSON.stringify({
            connectionName,
            contextPath,
          }),
          cacheStrategy: { ttl: 0, deduplicate: false },
        });

        if (cancelled) return;

        if (result?.dashboardId) {
          setDashboardId(result.dashboardId);
          setDone(true);
          // Auto-redirect after a brief pause
          setTimeout(() => {
            if (!cancelled) {
              router.push(`/f/${result.dashboardId}`);
            }
          }, 1500);
        } else {
          // Dashboard generated but no ID found - redirect to explore
          setDone(true);
          setError('Dashboard was created but we could not find it. Redirecting to explore...');
          setTimeout(() => {
            if (!cancelled) router.push('/');
          }, 3000);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[StepGenerating] Error:', err);
          setError('Something went wrong generating your dashboard.');
        }
      }
    })();

    return () => { cancelled = true; };
  }, [connectionName, contextFileId, router]);

  const currentPhrase = GENERATING_PHRASES[phraseIndex];

  return (
    <VStack gap={8} py={12} align="center" justify="center" minH="400px">
      <style>{pulseKeyframes}</style>
      <style>{sparkleKeyframes}</style>

      {/* Sparkle icon — large, animated */}
      <Box css={{ animation: 'sparkle 2s ease-in-out infinite' }}>
        <Icon as={LuSparkles} boxSize={12} color="accent.teal" />
      </Box>

      {!error && !done && (
        <>
          {/* Generating text */}
          <VStack gap={3}>
            <Heading size="lg" fontFamily="mono" fontWeight="400">
              Building your dashboard
            </Heading>
            <HStack gap={2}>
              <Text color="fg.muted" fontSize="sm" fontFamily="mono">
                {currentPhrase}
              </Text>
              <HStack gap={0.5}>
                <Box w="4px" h="4px" borderRadius="full" bg="accent.teal" css={{ animation: 'pulse 1.4s ease-in-out infinite' }} />
                <Box w="4px" h="4px" borderRadius="full" bg="accent.teal" css={{ animation: 'pulse 1.4s ease-in-out 0.2s infinite' }} />
                <Box w="4px" h="4px" borderRadius="full" bg="accent.teal" css={{ animation: 'pulse 1.4s ease-in-out 0.4s infinite' }} />
              </HStack>
            </HStack>
          </VStack>

          {/* Progress bar */}
          <Box w="200px" h="2px" bg="border.default" borderRadius="full" overflow="hidden">
            <Box
              h="100%"
              bg="accent.teal"
              borderRadius="full"
              css={{
                animation: 'generateProgress 90s ease-out forwards',
              }}
            />
          </Box>

          <Text color="fg.subtle" fontSize="xs" fontFamily="mono">
            This usually takes about a minute
          </Text>
        </>
      )}

      {/* Success state */}
      {done && !error && (
        <VStack gap={3}>
          <Heading size="lg" fontFamily="mono" fontWeight="400" color="accent.teal">
            Your dashboard is ready!
          </Heading>
          <Text color="fg.muted" fontSize="sm">
            Redirecting you now...
          </Text>
        </VStack>
      )}

      {/* Error state */}
      {error && (
        <VStack gap={4}>
          <Text color="fg.muted" fontSize="sm" textAlign="center" maxW="400px">
            {error}
          </Text>
          <HStack gap={3}>
            <Button
              variant="ghost"
              size="sm"
              fontFamily="mono"
              onClick={() => router.push('/')}
            >
              Go to home
            </Button>
            <Button
              bg="accent.teal"
              color="white"
              _hover={{ opacity: 0.9 }}
              size="sm"
              fontFamily="mono"
              onClick={() => router.push('/explore')}
            >
              <LuExternalLink size={14} />
              Open Explore
            </Button>
          </HStack>
        </VStack>
      )}

      {/* Progress bar animation */}
      <style>{`
        @keyframes generateProgress {
          0% { width: 0%; }
          10% { width: 15%; }
          30% { width: 35%; }
          50% { width: 55%; }
          70% { width: 70%; }
          90% { width: 85%; }
          100% { width: 95%; }
        }
      `}</style>
    </VStack>
  );
}
