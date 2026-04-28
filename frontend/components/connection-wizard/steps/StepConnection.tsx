'use client';

import { useState } from 'react';
import { Box, VStack, Text, Spinner } from '@chakra-ui/react';
import ConnectionContainerV2 from '@/components/containers/ConnectionContainerV2';
import ConnectionTypePicker from '@/components/shared/ConnectionTypePicker';
import { createDraftFile, editFile } from '@/lib/api/file-state';
import { useAppSelector } from '@/store/hooks';
import { resolvePath } from '@/lib/mode/path-resolver';
import type { ConnectionTypeOption } from '@/lib/ui/connection-type-options';

interface StepConnectionProps {
  onComplete: (connectionId: number, connectionName: string) => void;
  onStaticSelect?: (tab: 'csv' | 'sheets') => void;
  greeting?: string;
}

export default function StepConnection({ onComplete, onStaticSelect, greeting }: StepConnectionProps) {
  const [draftFileId, setDraftFileId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const userMode = useAppSelector(state => state.auth.user?.mode) || 'org';

  const handleTypeSelect = async (connType: ConnectionTypeOption) => {
    if (connType.comingSoon) return;

    if ('isStatic' in connType && connType.isStatic) {
      const tab = connType.type === 'google-sheets' ? 'sheets' : 'csv';
      onStaticSelect?.(tab);
      return;
    }

    setCreating(true);
    try {
      const folder = resolvePath(userMode, '/database');
      const id = await createDraftFile('connection', { folder });
      editFile({ fileId: id, changes: { content: { type: connType.type as any } } });
      setDraftFileId(id);
    } finally {
      setCreating(false);
    }
  };

  if (draftFileId) {
    return (
      <ConnectionContainerV2
        fileId={draftFileId}
        mode="create"
        skipTypePicker
        onSaveSuccess={onComplete}
        hideCancel
      />
    );
  }

  return (
    <Box p={6} overflowY="auto">
      <VStack align="stretch" gap={8} pb={4}>
        <VStack align="start" gap={2}>
          <Text fontSize="2xl" fontWeight="900" letterSpacing="-0.02em" fontFamily="mono">
            {greeting || 'Add Connection'}
          </Text>
          {!greeting && (
            <Text color="fg.muted" fontSize="sm">Select a database type to connect to</Text>
          )}
        </VStack>

        {creating && (
          <Box display="flex" justifyContent="center" py={4}>
            <Spinner size="lg" color="accent.teal" />
          </Box>
        )}

        <ConnectionTypePicker onSelect={handleTypeSelect} disabled={creating} />
      </VStack>
    </Box>
  );
}
