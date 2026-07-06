'use client';

import { useState } from 'react';
import { Box, VStack, Text, Spinner, Icon } from '@chakra-ui/react';
import { LuPlug } from 'react-icons/lu';
import ConnectionContainerV2 from '@/components/containers/ConnectionContainerV2';
import ConnectionTypePicker from '@/components/shared/ConnectionTypePicker';
import { createDraftFile, editFile } from '@/lib/file-state/file-state';
import { useAppSelector } from '@/store/hooks';
import { resolvePath } from '@/lib/mode/path-resolver';
import type { ConnectionTypeOption } from '@/lib/ui/connection-type-options';

const DATASOURCE_REQUEST_URL = 'https://forms.gle/9mXUGYUhULRRn68K6';

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
        onStaticSelect={onStaticSelect}
      />
    );
  }

  return (
    <Box p={{ base: 2, md: 6 }} overflowY="auto">
      <VStack align="stretch" gap={8} pb={4}>
        <VStack align="start" gap={2}>
          <Text fontSize={{ base: 'xl', md: '2xl' }} fontWeight="900" letterSpacing="-0.02em" fontFamily="mono">
            {greeting || 'Add Dataset'}
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

        <Text fontSize="sm" color="fg.muted" textAlign="center">
          Can&apos;t see your data source? <Icon as={LuPlug} boxSize={3.5} verticalAlign="text-bottom" />{' '}
          <a href={DATASOURCE_REQUEST_URL} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--chakra-colors-accent-teal)', textDecoration: 'underline' }}>
            Request it here.
          </a>
        </Text>
      </VStack>
    </Box>
  );
}
