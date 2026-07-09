'use client';

import { useState } from 'react';
import { Box, HStack, Text, Switch, Spinner } from '@chakra-ui/react';
import { LuUnplug } from 'react-icons/lu';
import { useConfigs, updateConfig } from '@/lib/hooks/useConfigs';
import { toaster } from '@/components/ui/toaster';

/**
 * Settings → Integrations: the Remote Agents feature toggle (OFF by default).
 * Gates Remote Agent Sessions ("Copy to Agent") end-to-end: the button in the chat header AND
 * server-side minting/live-code auth — switching it off immediately kills active session links.
 */
export function RemoteAgentsSection() {
  const { config } = useConfigs();
  const enabled = config.remoteAgentsEnabled === true;
  const [isSaving, setIsSaving] = useState(false);

  const handleToggle = async (checked: boolean) => {
    setIsSaving(true);
    try {
      await updateConfig({ remoteAgentsEnabled: checked });
      toaster.create({
        title: checked ? 'Remote Agents enabled' : 'Remote Agents disabled',
        ...(checked ? {} : { description: 'Any active session links stop working immediately.' }),
        type: 'success',
      });
    } catch (err) {
      toaster.create({ title: err instanceof Error ? err.message : 'Save failed', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Box p={4} bg="bg.surface" borderRadius="xl" shadow="sm" borderWidth="1px" borderColor="border">
      <HStack justify="space-between" align="start" gap={4}>
        <Box>
          <HStack mb={1} gap={1.5}>
            <LuUnplug size={14} color="var(--chakra-colors-accent-primary)" />
            <Text fontWeight="700" fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">
              Remote Agents
            </Text>
          </HStack>
          <Text fontSize="xs" color="fg.muted">
            Let an external AI agent (Claude Code, Codex, …) operate a chat session via a copyable
            link. Adds a &quot;Copy to agent&quot; button to the chat header. Session links are
            bearer credentials scoped to one conversation; anyone holding one can act as you there
            until it expires or you stop it.
          </Text>
        </Box>
        <HStack gap={2} flexShrink={0}>
          {isSaving && <Spinner size="xs" color="fg.muted" />}
          <Switch.Root
            aria-label="Remote Agents toggle"
            checked={enabled}
            disabled={isSaving}
            onCheckedChange={(details) => handleToggle(details.checked)}
            colorPalette="teal"
          >
            <Switch.HiddenInput />
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Root>
        </HStack>
      </HStack>
    </Box>
  );
}
