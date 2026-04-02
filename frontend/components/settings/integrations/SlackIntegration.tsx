'use client';

import { useEffect, useState, useCallback } from 'react';
import { Box, Button, HStack, Input, Text, VStack, Badge } from '@chakra-ui/react';
import { LuBot, LuTrash2, LuExternalLink, LuShieldCheck, LuCopy, LuCheck, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import { useConfigs, reloadConfigs } from '@/lib/hooks/useConfigs';
import { fetchWithCache } from '@/lib/api/fetch-wrapper';
import { toaster } from '@/components/ui/toaster';
import type { SlackBotConfig } from '@/lib/types';

const SLACK_BASE_URL_STORAGE_KEY = 'slack-base-url';

function maskToken(token: string): string {
  if (token.length <= 8) return '********';
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function maskSecret(secret: string): string {
  if (secret.length <= 6) return '******';
  return `${secret.slice(0, 3)}...${secret.slice(-3)}`;
}

function StepBadge({ n, done }: { n: number; done?: boolean }) {
  return (
    <Box
      w={6} h={6} borderRadius="full"
      bg={done ? 'teal.500' : 'bg.muted'}
      color={done ? 'white' : 'fg.muted'}
      display="flex" alignItems="center" justifyContent="center"
      fontSize="xs" fontWeight="bold" fontFamily="mono"
      flexShrink={0}
    >
      {done ? <LuCheck size={12} /> : n}
    </Box>
  );
}

function SlackSetupGuide() {
  const { config } = useConfigs();
  const [baseUrl, setBaseUrl] = useState(() =>
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'
  );
  const [manifestJson, setManifestJson] = useState<string | null>(null);
  const [isLoadingManifest, setIsLoadingManifest] = useState(false);
  const [copied, setCopied] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [signingSecret, setSigningSecret] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeletingTeamId, setIsDeletingTeamId] = useState<string | null>(null);

  const slackBots = (config.bots ?? []).filter((bot): bot is SlackBotConfig => bot.type === 'slack');

  useEffect(() => {
    const savedBaseUrl = window.localStorage.getItem(SLACK_BASE_URL_STORAGE_KEY)?.trim();
    if (savedBaseUrl) setBaseUrl(savedBaseUrl);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SLACK_BASE_URL_STORAGE_KEY, baseUrl.trim());
  }, [baseUrl]);

  const loadManifest = useCallback(async () => {
    setIsLoadingManifest(true);
    setManifestJson(null);
    try {
      const query = new URLSearchParams({ baseUrl: baseUrl.trim() });
      const response = await fetch(`/api/integrations/slack/manifest?${query.toString()}`, {
        method: 'GET',
        credentials: 'include',
      });
      if (!response.ok) {
        const text = await response.text();
        let message = 'Failed to load Slack manifest';
        try {
          const json = JSON.parse(text);
          if (json.error?.message) message = json.error.message;
        } catch {
          // ignore parse error
        }
        throw new Error(message);
      }
      const text = await response.text();
      setManifestJson(text);
    } catch (error) {
      toaster.create({
        title: 'Failed to load manifest',
        description: error instanceof Error ? error.message : 'Check that your URL is a public HTTPS URL.',
        type: 'error',
      });
    } finally {
      setIsLoadingManifest(false);
    }
  }, [baseUrl]);

  const handleCopy = () => {
    if (!manifestJson) return;
    void navigator.clipboard.writeText(manifestJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenInSlack = () => {
    if (!manifestJson) return;
    const slackUrl = `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(manifestJson)}`;
    window.open(slackUrl, '_blank', 'noopener,noreferrer');
  };

  const handleConnect = async () => {
    if (!botToken.trim()) {
      toaster.create({ title: 'Missing token', description: 'Paste the Slack bot token first.', type: 'error' });
      return;
    }
    setIsSubmitting(true);
    try {
      await fetchWithCache('/api/integrations/slack/manual-install', {
        method: 'POST',
        skipCache: true,
        body: JSON.stringify({
          baseUrl: baseUrl.trim(),
          botToken: botToken.trim(),
          signingSecret: signingSecret.trim(),
        }),
      });
      setBotToken('');
      setSigningSecret('');
      await reloadConfigs();
      toaster.create({ title: 'Slack bot connected', type: 'success' });
    } catch (error) {
      toaster.create({
        title: 'Connection failed',
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
      toaster.create({ title: 'Slack bot removed', type: 'success' });
    } catch (error) {
      toaster.create({
        title: 'Failed to remove',
        description: error instanceof Error ? error.message : 'Delete failed.',
        type: 'error',
      });
    } finally {
      setIsDeletingTeamId(null);
    }
  };

  return (
    <VStack align="stretch" gap={4}>
      {/* Step 1: Instance URL */}
      <Box borderWidth="1px" borderColor="border" borderRadius="md" p={4}>
        <HStack gap={3} mb={3}>
          <StepBadge n={1} />
          <Text fontSize="sm" fontWeight="semibold" fontFamily="mono">Set your public URL</Text>
        </HStack>
        <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={3}>
          The HTTPS URL where your MinusX instance is publicly reachable. Slack will POST events here.
          Use your ngrok URL in development.
        </Text>
        <Input
          aria-label="Slack public base URL"
          size="sm"
          fontFamily="mono"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://your-public-url.example.com"
        />
      </Box>

      {/* Step 2: Manifest */}
      <Box borderWidth="1px" borderColor="border" borderRadius="md" p={4}>
        <HStack gap={3} mb={3}>
          <StepBadge n={2} />
          <Text fontSize="sm" fontWeight="semibold" fontFamily="mono">Create your Slack app</Text>
        </HStack>
        <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={3}>
          Generate the manifest, then use it to create a new Slack app in your workspace. Requires a public HTTPS URL from Step 1.
        </Text>
        <HStack gap={2} mb={manifestJson ? 3 : 0} wrap="wrap">
          <Button
            aria-label="Generate Slack manifest"
            size="sm"
            variant="outline"
            onClick={loadManifest}
            loading={isLoadingManifest}
          >
            Generate manifest
          </Button>
          {manifestJson && (
            <>
              <Button
                aria-label="Copy manifest JSON"
                size="sm"
                variant="outline"
                onClick={handleCopy}
              >
                {copied ? <LuCheck size={12} /> : <LuCopy size={12} />}
                {copied ? 'Copied!' : 'Copy JSON'}
              </Button>
              <Button
                aria-label="Open Slack app creation"
                size="sm"
                colorPalette="teal"
                onClick={handleOpenInSlack}
              >
                <LuExternalLink size={12} />
                Open in Slack
              </Button>
            </>
          )}
        </HStack>
        {manifestJson && (
          <Box
            as="pre"
            fontSize="2xs"
            fontFamily="mono"
            bg="bg.subtle"
            borderRadius="md"
            p={3}
            overflowX="auto"
            maxH="260px"
            overflowY="auto"
            borderWidth="1px"
            borderColor="border"
            whiteSpace="pre"
          >
            {manifestJson}
          </Box>
        )}
      </Box>

      {/* Step 3: Connect credentials */}
      <Box borderWidth="1px" borderColor="border" borderRadius="md" p={4}>
        <HStack gap={3} mb={3}>
          <StepBadge n={3} />
          <Text fontSize="sm" fontWeight="semibold" fontFamily="mono">Connect credentials</Text>
        </HStack>
        <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={3}>
          After installing the Slack app, paste the bot token and signing secret from your Slack app&apos;s <em>Basic Information</em> page.
        </Text>
        <VStack align="stretch" gap={3}>
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
              placeholder="From Slack Basic Information"
            />
          </Box>
          <Button
            aria-label="Connect Slack bot"
            size="sm"
            alignSelf="flex-start"
            colorPalette="teal"
            onClick={handleConnect}
            loading={isSubmitting}
          >
            <LuShieldCheck size={14} />
            Connect
          </Button>
        </VStack>
      </Box>

      {/* Connected workspaces */}
      {slackBots.length > 0 && (
        <Box>
          <Text fontSize="xs" fontWeight="semibold" fontFamily="mono" color="fg.muted" mb={2} textTransform="uppercase" letterSpacing="wide">
            Connected workspaces
          </Text>
          <VStack align="stretch" gap={2}>
            {slackBots.map((bot) => (
              <Box key={bot.team_id || bot.name} borderWidth="1px" borderColor="border" borderRadius="md" p={3}>
                <HStack justify="space-between" align="start">
                  <VStack align="start" gap={1}>
                    <HStack>
                      <Badge colorPalette="teal" size="sm">Active</Badge>
                      <Text fontSize="sm" fontWeight="medium" fontFamily="mono">{bot.team_name || bot.name}</Text>
                    </HStack>
                    <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                      Team: {bot.team_id || '(pending)'}
                    </Text>
                    <Text fontSize="xs" color="fg.subtle" fontFamily="mono">
                      Token: {maskToken(bot.bot_token)}
                    </Text>
                    {bot.signing_secret && (
                      <Text fontSize="xs" color="fg.subtle" fontFamily="mono">
                        Secret: {maskSecret(bot.signing_secret)}
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
            ))}
          </VStack>
        </Box>
      )}
    </VStack>
  );
}

export function SlackIntegration() {
  const [expanded, setExpanded] = useState(false);
  const { config } = useConfigs();
  const slackBots = (config.bots ?? []).filter((bot): bot is SlackBotConfig => bot.type === 'slack');

  return (
    <Box borderWidth="1px" borderColor="border" borderRadius="md" overflow="hidden">
      <HStack
        p={4}
        justify="space-between"
        cursor="pointer"
        onClick={() => setExpanded(!expanded)}
        _hover={{ bg: 'bg.subtle' }}
        transition="background 0.15s ease"
      >
        <HStack gap={3}>
          <LuBot size={18} />
          <Box>
            <Text fontWeight="semibold" fontFamily="mono" fontSize="sm">Slack</Text>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono">
              {slackBots.length > 0
                ? `${slackBots.length} workspace${slackBots.length > 1 ? 's' : ''} connected`
                : 'Not connected — click to set up'}
            </Text>
          </Box>
        </HStack>
        <HStack gap={2}>
          {slackBots.length > 0 && <Badge colorPalette="teal" size="sm">Active</Badge>}
          {expanded ? <LuChevronDown size={16} /> : <LuChevronRight size={16} />}
        </HStack>
      </HStack>
      {expanded && (
        <Box p={4} borderTopWidth="1px" borderTopColor="border">
          <SlackSetupGuide />
        </Box>
      )}
    </Box>
  );
}
