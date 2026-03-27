'use client';

import { useState, useEffect } from 'react';
import { Box, VStack, HStack, Text, Button } from '@chakra-ui/react';
import { LuBell, LuSave } from 'react-icons/lu';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { updateFileContent } from '@/store/filesSlice';
import { useConfigs, reloadConfigs } from '@/lib/hooks/useConfigs';
import { useFileByPath } from '@/lib/hooks/file-state-hooks';
import { resolvePath } from '@/lib/mode/path-resolver';
import { FilesAPI } from '@/lib/data/files';
import { DeliveryCard } from '@/components/shared/DeliveryPicker';
import type { AlertRecipient, ConfigContent } from '@/lib/types';
import type { Mode } from '@/lib/mode/mode-types';

export function ErrorDeliverySection() {
  const dispatch = useAppDispatch();
  const user = useAppSelector(state => state.auth.user);
  const { config } = useConfigs();

  const configPath = user ? resolvePath(user.mode as Mode, '/configs/config') : null;
  const { file: configFile } = useFileByPath(configPath);

  const [recipients, setRecipients] = useState<AlertRecipient[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync from config on load (only when not dirty)
  useEffect(() => {
    if (!isDirty) {
      setRecipients(config.error_delivery ?? []);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.error_delivery]);

  const handleSave = async () => {
    if (!configPath) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const currentContent = (configFile?.fileState.content ?? {}) as ConfigContent;
      const newContent: ConfigContent = { ...currentContent, error_delivery: recipients };

      if (configFile && typeof configFile.fileState.id === 'number') {
        await FilesAPI.saveFile(configFile.fileState.id, configFile.fileState.name, configFile.fileState.path, newContent, []);
        dispatch(updateFileContent({ id: configFile.fileState.id, file: { ...configFile.fileState, content: newContent } }));
      } else {
        await FilesAPI.createFile({ name: 'config', path: configPath, type: 'config', content: newContent, references: [] });
      }

      setIsSyncing(true);
      try {
        await reloadConfigs();
      } finally {
        setIsSyncing(false);
      }
      setIsDirty(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Box p={4}>
      <HStack mb={2} gap={1.5}>
        <LuBell size={14} color="var(--chakra-colors-accent-primary)" />
        <Text fontWeight="700" fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">
          Error Notifications
          {isSyncing && <Text as="span" ml={2} fontWeight="400" textTransform="none" letterSpacing="normal">Syncing config...</Text>}
        </Text>
      </HStack>
      <Text fontSize="xs" color="fg.muted" mb={3}>
        Where to send app error alerts (Python errors, tool failures, stream errors)
      </Text>
      <VStack align="stretch" gap={2}>
        <DeliveryCard
          recipients={recipients}
          onChange={(r) => { setRecipients(r); setIsDirty(true); setSaveError(null); }}
        />
        {saveError && (
          <Text fontSize="xs" color="red.500">{saveError}</Text>
        )}
        {isDirty && (
          <Button size="sm" alignSelf="flex-end" onClick={handleSave} loading={isSaving} disabled={isSaving}>
            <LuSave /> Save
          </Button>
        )}
      </VStack>
    </Box>
  );
}
