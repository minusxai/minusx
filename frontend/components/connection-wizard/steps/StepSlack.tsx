'use client';

import { useState, useEffect, useCallback } from 'react';
import { Box, VStack, HStack, Text, Heading, Button, Icon } from '@chakra-ui/react';
import { LuMessageSquare, LuExternalLink, LuCheck } from 'react-icons/lu';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { cursorBlinkKeyframes } from '@/lib/ui/animations';
import { Link } from '@/components/ui/Link';
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

  // Two independent capabilities, three rendered states — see the block above the card below.
  const [isOAuthConfigured, setIsOAuthConfigured] = useState(false);
  const [isSelfHostEnabled, setIsSelfHostEnabled] = useState(false);

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
      .then(r => r.ok ? r.json() : { data: { configured: false, selfHostedEnabled: false } })
      .then((body: { data?: { configured?: boolean; selfHostedEnabled?: boolean } }) => {
        setIsOAuthConfigured(body.data?.configured ?? false);
        setIsSelfHostEnabled(body.data?.selfHostedEnabled ?? false);
      })
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
              {/* Hosted OAuth: one click, nothing to configure. */}
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

              {/* No hosted credentials, but Slack can reach this instance — the admin can register
                  their own app. Signpost, don't inline: that guide spans a public-URL field, a
                  generated manifest, a round trip to api.slack.com and two pasted secrets. It is the
                  heaviest task in the product and belongs nowhere near the end of first-run setup,
                  and Settings already renders it as the primary flow when OAuth is absent. */}
              {!isOAuthConfigured && isSelfHostEnabled && (
                <>
                  <Text fontSize="xs" color="fg.subtle" fontFamily="mono" textAlign="center" maxW="400px">
                    This workspace doesn&apos;t have one-click install, but you can connect your own
                    Slack app.
                  </Text>
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    fontFamily="mono"
                  >
                    <Link href="/settings?tab=integrations">
                      <LuExternalLink size={14} />
                      Set up Slack in Settings
                    </Link>
                  </Button>
                </>
              )}

              {/* Neither flow can work: Slack delivers events over the public internet, and this
                  instance has no public HTTPS URL to deliver them to. Offering a button here would
                  send the user to a guide that 403s at its second step. */}
              {!isOAuthConfigured && !isSelfHostEnabled && (
                <Text fontSize="xs" color="fg.subtle" fontFamily="mono" textAlign="center" maxW="400px">
                  Slack needs a public HTTPS URL to reach this workspace. Once this instance has one,
                  connect Slack from Settings.
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
