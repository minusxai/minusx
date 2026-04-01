'use client';

import { useState, useEffect } from 'react';
import { Box, VStack, HStack, Text, Button } from '@chakra-ui/react';
import { LuBell, LuSave } from 'react-icons/lu';
import { useConfigs, updateConfig } from '@/lib/hooks/useConfigs';
import { DeliveryCard } from '@/components/shared/DeliveryPicker';
import type { AlertRecipient } from '@/lib/types';

export function ErrorDeliverySection() {
  const { config } = useConfigs();

  const [recipients, setRecipients] = useState<AlertRecipient[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync from config on load (only when not dirty)
  useEffect(() => {
    if (!isDirty) {
      setRecipients(config.error_delivery ?? []);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.error_delivery]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await updateConfig({ error_delivery: recipients });
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
