'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Box, VStack, HStack, Text, Input, Button, Badge, Textarea,
  Heading, Separator,
} from '@chakra-ui/react';
import { LuPlus, LuTrash2, LuChevronDown, LuChevronUp, LuSave } from 'react-icons/lu';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { useConfigs, reloadConfigs } from '@/lib/hooks/useConfigs';
import { useFileByPath } from '@/lib/hooks/file-state-hooks';
import { resolvePath } from '@/lib/mode/path-resolver';
import { FilesAPI } from '@/lib/data/files';
import type { ConfigChannel, ConfigContent } from '@/lib/types';
import type { Mode } from '@/lib/mode/mode-types';

// ─── channel-type metadata ───────────────────────────────────────────────────

const CHANNEL_TYPES = ['slack', 'email', 'phone'] as const;
type ChannelType = typeof CHANNEL_TYPES[number];

function channelLabel(type: ChannelType) {
  return type === 'slack' ? 'Slack' : type === 'email' ? 'Email' : 'Phone';
}

function channelBadgeColor(type: ChannelType) {
  return type === 'slack' ? 'accent.warning' : type === 'email' ? 'accent.danger' : 'accent.primary';
}

function channelSummary(ch: ConfigChannel) {
  if (ch.type === 'slack') return ch.webhook_url || '(no URL)';
  return ch.address || '(no address)';
}

// ─── blank channel factories ─────────────────────────────────────────────────

function blankChannel(type: ChannelType): ConfigChannel {
  if (type === 'slack') return { type: 'slack', name: '', webhook_url: '', properties: undefined };
  return { type, name: '', address: '' };
}

// ─── single channel row ───────────────────────────────────────────────────────

interface ChannelRowProps {
  channel: ConfigChannel;
  onChange: (ch: ConfigChannel) => void;
  onDelete: () => void;
  initiallyExpanded?: boolean;
}

function ChannelRow({ channel, onChange, onDelete, initiallyExpanded = false }: ChannelRowProps) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [propertiesText, setPropertiesText] = useState(
    channel.type === 'slack' && channel.properties
      ? JSON.stringify(channel.properties, null, 2)
      : ''
  );
  const [propertiesError, setPropertiesError] = useState<string | null>(null);

  const handlePropertiesChange = (text: string) => {
    setPropertiesText(text);
    if (!text.trim()) {
      setPropertiesError(null);
      if (channel.type === 'slack') onChange({ ...channel, properties: undefined });
      return;
    }
    try {
      const parsed = JSON.parse(text);
      setPropertiesError(null);
      if (channel.type === 'slack') onChange({ ...channel, properties: parsed });
    } catch {
      setPropertiesError('Invalid JSON');
    }
  };

  return (
    <Box
      border="1px solid"
      borderColor="border.muted"
      borderRadius="md"
      overflow="hidden"
    >
      {/* collapsed header row */}
      <HStack
        px={3}
        py={2}
        gap={2}
        cursor="pointer"
        _hover={{ bg: 'bg.subtle' }}
        onClick={() => setExpanded(e => !e)}
      >
        <Badge size="xs" color={channelBadgeColor(channel.type)} flexShrink={0}>
          {channelLabel(channel.type)}
        </Badge>
        <Text fontSize="sm" fontWeight="medium" fontFamily="mono" flex="1" truncate>
          {channel.name || <Text as="span" color="fg.muted">(unnamed)</Text>}
        </Text>
        <Text fontSize="xs" color="fg.muted" fontFamily="mono" flex="2" truncate>
          {channelSummary(channel)}
        </Text>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'inherit', flexShrink: 0 }}
          aria-label="Delete channel"
        >
          <LuTrash2 size={14} />
        </button>
        {expanded ? <LuChevronUp size={14} /> : <LuChevronDown size={14} />}
      </HStack>

      {/* expanded edit form */}
      {expanded && (
        <Box px={3} pb={3} pt={1} borderTop="1px solid" borderColor="border.muted" bg="bg.subtle">
          <VStack align="stretch" gap={2}>
            <HStack gap={2}>
              <Box flex="1">
                <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={1}>Name</Text>
                <Input
                  size="sm"
                  fontFamily="mono"
                  value={channel.name}
                  onChange={(e) => onChange({ ...channel, name: e.target.value })}
                  placeholder="e.g. Engineering"
                />
              </Box>
            </HStack>

            {channel.type === 'slack' && (
              <>
                <Box>
                  <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={1}>Webhook URL</Text>
                  <Input
                    size="sm"
                    fontFamily="mono"
                    value={channel.webhook_url}
                    onChange={(e) => onChange({ ...channel, webhook_url: e.target.value })}
                    placeholder="https://hooks.slack.com/services/..."
                  />
                </Box>
                <Box>
                  <HStack justify="space-between" mb={1}>
                    <Text fontSize="xs" color="fg.muted" fontFamily="mono">Properties (optional JSON)</Text>
                    {propertiesError && (
                      <Text fontSize="xs" color="accent.danger" fontFamily="mono">{propertiesError}</Text>
                    )}
                  </HStack>
                  <Textarea
                    size="sm"
                    fontFamily="mono"
                    fontSize="xs"
                    value={propertiesText}
                    onChange={(e) => handlePropertiesChange(e.target.value)}
                    placeholder={'{\n  "username": "AlertBot",\n  "icon_emoji": ":bell:"\n}'}
                    rows={3}
                  />
                </Box>
              </>
            )}

            {(channel.type === 'email' || channel.type === 'phone') && (
              <Box>
                <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={1}>
                  {channel.type === 'email' ? 'Email address' : 'Phone number'}
                </Text>
                <Input
                  size="sm"
                  fontFamily="mono"
                  value={channel.address}
                  onChange={(e) => onChange({ ...channel, address: e.target.value })}
                  placeholder={channel.type === 'email' ? 'team@company.com' : '+1 555-0100'}
                />
              </Box>
            )}
          </VStack>
        </Box>
      )}
    </Box>
  );
}

// ─── main section ─────────────────────────────────────────────────────────────

export function ChannelsSection() {
  const dispatch = useAppDispatch();
  const user = useAppSelector(state => state.auth.user);
  const { config } = useConfigs();

  const configPath = user ? resolvePath(user.mode as Mode, '/configs/config') : null;
  const { file: configFile, loading: fileLoading } = useFileByPath(configPath);

  const [channels, setChannels] = useState<ConfigChannel[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync from config on load (only when not dirty — avoid clobbering edits)
  useEffect(() => {
    if (!isDirty) {
      setChannels(config.channels ?? []);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.channels]);

  const update = useCallback((updated: ConfigChannel[]) => {
    setChannels(updated);
    setIsDirty(true);
    setSaveError(null);
  }, []);

  const addChannel = (type: ChannelType) => {
    update([...channels, blankChannel(type)]);
  };

  const handleSave = async () => {
    if (!configPath) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const currentContent = (configFile?.fileState.content ?? {}) as ConfigContent;
      const newContent: ConfigContent = { ...currentContent, channels };

      if (configFile && typeof configFile.fileState.id === 'number') {
        await FilesAPI.saveFile(configFile.fileState.id, configFile.fileState.name, configFile.fileState.path, newContent, []);
      } else {
        await FilesAPI.createFile({ name: 'config', path: configPath, type: 'config', content: newContent, references: [] });
      }

      await reloadConfigs();
      setIsDirty(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <VStack align="stretch" gap={4} p={6}>
      <HStack justify="space-between" align="center">
        <Heading size="sm" fontFamily="mono">Channels</Heading>
        <HStack gap={2}>
          {CHANNEL_TYPES.map(type => (
            <Button key={type} size="xs" variant="outline" onClick={() => addChannel(type)}>
              <LuPlus size={12} />
              {channelLabel(type)}
            </Button>
          ))}
        </HStack>
      </HStack>

      <Text fontSize="xs" color="fg.muted" fontFamily="mono">
        Named delivery endpoints reused across alerts. Slack channels use the configured <code>slack_alert</code> webhook as the HTTP mechanism.
      </Text>

      <Separator />

      {fileLoading ? (
        <Text fontSize="sm" color="fg.muted" fontFamily="mono">Loading...</Text>
      ) : channels.length === 0 ? (
        <Text fontSize="sm" color="fg.muted" fontFamily="mono">No channels configured. Add one above.</Text>
      ) : (
        <VStack align="stretch" gap={2}>
          {channels.map((ch, i) => (
            <ChannelRow
              key={i}
              channel={ch}
              onChange={(updated) => {
                const next = [...channels];
                next[i] = updated;
                update(next);
              }}
              onDelete={() => update(channels.filter((_, j) => j !== i))}
              initiallyExpanded={!ch.name}
            />
          ))}
        </VStack>
      )}

      {isDirty && (
        <HStack justify="flex-end" gap={3}>
          {saveError && <Text fontSize="xs" color="accent.danger" fontFamily="mono">{saveError}</Text>}
          <Button
            size="sm"
            colorPalette="teal"
            onClick={handleSave}
            loading={isSaving}
            disabled={isSaving}
          >
            <LuSave />
            Save
          </Button>
        </HStack>
      )}
    </VStack>
  );
}
