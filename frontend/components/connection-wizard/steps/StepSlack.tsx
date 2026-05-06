'use client';

import { useState, useEffect, useCallback } from 'react';
import { Box, VStack, HStack, Text, Heading, Button, Icon } from '@chakra-ui/react';
import { LuMessageSquare, LuExternalLink, LuCheck } from 'react-icons/lu';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { cursorBlinkKeyframes } from '@/lib/ui/animations';
import type { SlackBotConfig } from '@/lib/types';

const TYPEWRITER_SPEED = 35;

interface StepSlackProps {
  onComplete: () => void;
  greeting?: string;
}

export default function StepSlack({ onComplete, greeting }: StepSlackProps) {
  const { config } = useConfigs();
  const slackBots = (config.bots ?? []).filter((bot): bot is SlackBotConfig => bot.type === 'slack');
  const isConnected = slackBots.length > 0;

  const [isOAuthConfigured, setIsOAuthConfigured] = useState(false);

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

  useEffect(() => {
    fetch('/api/integrations/slack/oauth-configured', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { data: { configured: false } })
      .then((body: { data?: { configured?: boolean } }) => setIsOAuthConfigured(body.data?.configured ?? false))
      .catch(() => {});
  }, []);

  const handleAddToSlack = useCallback(() => {
    window.open('/api/integrations/slack/oauth-start', '_blank');
  }, []);

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
            Connect Slack
          </Heading>
        )}
        <Text color="fg.muted" fontSize="sm">
          Chat with the agent directly from Slack — ask questions, get charts, and share insights with your team.
        </Text>
      </Box>

      {/* Slack card */}
      <Box
        border="1px solid"
        borderColor={isConnected ? 'accent.teal/30' : 'border.default'}
        borderRadius="lg"
        p={6}
        bg={isConnected ? 'accent.teal/5' : 'bg.surface'}
      >
        <VStack gap={4} align="center" py={4}>
          <Icon as={LuMessageSquare} boxSize={10} color={isConnected ? 'accent.teal' : 'fg.muted'} />

          {isConnected ? (
            <>
              <HStack gap={2}>
                <Icon as={LuCheck} boxSize={5} color="accent.teal" />
                <Text fontSize="md" fontFamily="mono" fontWeight="500" color="accent.teal">
                  Slack connected!
                </Text>
              </HStack>
              <Text fontSize="sm" color="fg.muted" textAlign="center">
                Workspace: {slackBots[0]?.team_name ?? 'Connected'}
              </Text>
            </>
          ) : (
            <>
              <Text fontSize="md" fontFamily="mono" fontWeight="500">
                Add to Slack
              </Text>
              <Text fontSize="sm" color="fg.muted" textAlign="center" maxW="400px">
                Install the bot to your workspace so your team can ask questions and get answers directly in Slack.
              </Text>
              {isOAuthConfigured && (
                <Button
                  bg="accent.teal"
                  color="white"
                  _hover={{ opacity: 0.9 }}
                  size="sm"
                  fontFamily="mono"
                  onClick={handleAddToSlack}
                >
                  <LuExternalLink size={14} />
                  Add to Slack
                </Button>
              )}
              {!isOAuthConfigured && (
                <Text fontSize="xs" color="fg.subtle" fontFamily="mono">
                  Slack OAuth is not configured. You can set this up later in Settings.
                </Text>
              )}
            </>
          )}
        </VStack>
      </Box>

      {/* Spacer */}
      <Box flex={1} />

      {/* Footer */}
      <HStack justify="flex-end">
        <Button
          bg={isConnected ? 'accent.teal' : undefined}
          color={isConnected ? 'white' : undefined}
          variant={isConnected ? undefined : 'outline'}
          _hover={isConnected ? { opacity: 0.9 } : undefined}
          size="sm"
          fontFamily="mono"
          onClick={onComplete}
        >
          {isConnected ? 'Continue' : 'Skip for now'} &rarr;
        </Button>
      </HStack>
    </VStack>
  );
}
