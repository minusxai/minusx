'use client';

import { useMemo, useState } from 'react';
import { Box, Button, HStack, Input, Text, VStack, Heading, Badge } from '@chakra-ui/react';
import { LuBot, LuTrash2, LuExternalLink, LuShieldCheck } from 'react-icons/lu';
import { useConfigs, reloadConfigs } from '@/lib/hooks/useConfigs';
import { fetchWithCache } from '@/lib/api/fetch-wrapper';
import { toaster } from '@/components/ui/toaster';
import type { SlackBotConfig } from '@/lib/types';
import { AUTH_URL } from '@/lib/constants';

function maskToken(token: string): string {
  if (token.length <= 8) {
    return '********';
  }
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function maskSecret(secret: string): string {
  if (secret.length <= 6) {
    return '******';
  }
  return `${secret.slice(0, 3)}...${secret.slice(-3)}`;
}

export function SlackBotSection() {
  const { config } = useConfigs();
  const [botName, setBotName] = useState('');
  const [botToken, setBotToken] = useState('');
  const [signingSecret, setSigningSecret] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeletingTeamId, setIsDeletingTeamId] = useState<string | null>(null);
  const hasPublicAuthUrl = useMemo(() => {
    try {
      const parsed = new URL(AUTH_URL);
      const hostname = parsed.hostname.toLowerCase();
      return (
        parsed.protocol === 'https:' &&
        hostname !== 'localhost' &&
        hostname !== '127.0.0.1' &&
        hostname !== '0.0.0.0'
      );
    } catch {
      return false;
    }
  }, []);

  const slackBots = useMemo(
    () => (config.bots ?? []).filter((bot): bot is SlackBotConfig => bot.type === 'slack'),
    [config.bots],
  );

  const handleOpenManifest = () => {
    void (async () => {
      try {
        const response = await fetch('/api/integrations/slack/manifest', {
          method: 'GET',
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error('Failed to load Slack manifest');
        }

        const manifestText = await response.text();
        const slackUrl = `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(manifestText)}`;
        window.open(slackUrl, '_blank', 'noopener,noreferrer');
      } catch (error) {
        console.error('[SlackBotSection] Failed to open Slack manifest flow', error);
        toaster.create({
          title: 'Unable to open Slack',
          description: 'Failed to generate the Slack app manifest.',
          type: 'error',
        });
      }
    })();
  };

  const handleManualInstall = async () => {
    if (!botToken.trim()) {
      toaster.create({
        title: 'Missing token',
        description: 'Paste the Slack bot token first.',
        type: 'error',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await fetchWithCache('/api/integrations/slack/manual-install', {
        method: 'POST',
        skipCache: true,
        body: JSON.stringify({
          botToken: botToken.trim(),
          signingSecret: signingSecret.trim(),
          name: botName.trim(),
        }),
      });

      setBotToken('');
      setSigningSecret('');
      setBotName('');
      await reloadConfigs();
      toaster.create({
        title: 'Slack bot saved',
        description: 'The Slack workspace was validated and stored in company config.',
        type: 'success',
      });
    } catch (error) {
      toaster.create({
        title: 'Slack bot install failed',
        description: error instanceof Error ? error.message : 'Unable to validate Slack bot token.',
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (teamId: string) => {
    setIsDeletingTeamId(teamId);
    try {
      await fetchWithCache(`/api/integrations/slack/bots/${encodeURIComponent(teamId)}`, {
        method: 'DELETE',
        skipCache: true,
      });
      await reloadConfigs();
      toaster.create({
        title: 'Slack bot removed',
        type: 'success',
      });
    } catch (error) {
      toaster.create({
        title: 'Failed to remove Slack bot',
        description: error instanceof Error ? error.message : 'Delete failed.',
        type: 'error',
      });
    } finally {
      setIsDeletingTeamId(null);
    }
  };

  return (
    <VStack align="stretch" gap={4} p={6}>
      <HStack justify="space-between" align="center">
        <HStack gap={2}>
          <LuBot size={16} />
          <Heading size="sm" fontFamily="mono">Bots</Heading>
        </HStack>
      </HStack>

      <Text fontSize="xs" color="fg.muted" fontFamily="mono">
        Configure workspace bots backed by company config. Slack is the first bot type; future bot integrations can reuse this surface.
      </Text>

      {!hasPublicAuthUrl && (
        <Box borderWidth="1px" borderColor="border" borderRadius="md" p={4}>
          <Text fontSize="sm" fontFamily="mono">
            Slack bot install is disabled on this instance. Set <code>AUTH_URL</code> to a public HTTPS URL first.
          </Text>
        </Box>
      )}

      {hasPublicAuthUrl && (
        <Box borderWidth="1px" borderColor="border" borderRadius="md" p={4}>
          <VStack align="stretch" gap={3}>
            <Text fontSize="sm" fontWeight="medium" fontFamily="mono">Slack</Text>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono">
              Slack messages run as the matching MinusX user by email. If a Slack user email does not exist in this company, the bot will reply with a configuration error.
            </Text>

            <VStack align="stretch" gap={2}>
              <HStack justify="space-between">
                <Text fontSize="xs" color="fg.muted" fontFamily="mono">Self-hosted manifest flow</Text>
                <Button aria-label="Create Slack app from manifest" size="xs" variant="outline" onClick={handleOpenManifest}>
                  <LuExternalLink size={12} />
                  Create Slack App
                </Button>
              </HStack>
              <Box>
                <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={1}>Bot name (optional)</Text>
                <Input
                  aria-label="Slack bot name"
                  size="sm"
                  fontFamily="mono"
                  value={botName}
                  onChange={(e) => setBotName(e.target.value)}
                  placeholder="Slack"
                />
              </Box>
              <Box>
                <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={1}>Bot token</Text>
                <Input
                  aria-label="Slack bot token"
                  size="sm"
                  type="password"
                  fontFamily="mono"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder="xoxb-..."
                />
              </Box>
              <Box>
                <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={1}>Signing secret</Text>
                <Input
                  aria-label="Slack signing secret"
                  size="sm"
                  type="password"
                  fontFamily="mono"
                  value={signingSecret}
                  onChange={(e) => setSigningSecret(e.target.value)}
                  placeholder="Paste from Slack Basic Information"
                />
              </Box>
              <Button aria-label="Save self-hosted Slack bot" size="sm" alignSelf="flex-start" onClick={handleManualInstall} loading={isSubmitting}>
                <LuShieldCheck size={14} />
                Save Self-Hosted Bot
              </Button>
            </VStack>
          </VStack>
        </Box>
      )}

      <VStack align="stretch" gap={2}>
        {slackBots.length === 0 ? (
          <Text fontSize="sm" color="fg.muted" fontFamily="mono">No bots configured yet.</Text>
        ) : (
          slackBots.map((bot) => (
            <Box key={bot.team_id || bot.name} borderWidth="1px" borderColor="border" borderRadius="md" p={3}>
              <HStack justify="space-between" align="start">
                <VStack align="start" gap={1}>
                  <HStack>
                    <Badge colorPalette="blue">Manifest</Badge>
                    <Text fontSize="sm" fontWeight="medium" fontFamily="mono">{bot.team_name || bot.name}</Text>
                  </HStack>
                  <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                    Team: {bot.team_id || '(pending)'} | User mapping: Slack email {'->'} MinusX email
                  </Text>
                  <Text fontSize="xs" color="fg.subtle" fontFamily="mono">
                    Token: {maskToken(bot.bot_token)}
                  </Text>
                  {bot.signing_secret && (
                    <Text fontSize="xs" color="fg.subtle" fontFamily="mono">
                      Signing secret: {maskSecret(bot.signing_secret)}
                    </Text>
                  )}
                </VStack>
                {bot.team_id && (
                  <Button
                    aria-label={`Remove Slack bot ${bot.team_name || bot.name}`}
                    size="xs"
                    variant="ghost"
                    colorPalette="red"
                    onClick={() => handleDelete(bot.team_id!)}
                    loading={isDeletingTeamId === bot.team_id}
                  >
                    <LuTrash2 size={12} />
                  </Button>
                )}
              </HStack>
            </Box>
          ))
        )}
      </VStack>
    </VStack>
  );
}
