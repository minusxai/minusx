'use client';

import { useEffect, useState } from 'react';
import { Box, Spinner } from '@chakra-ui/react';
import ConnectionContainerV2 from '@/components/containers/ConnectionContainerV2';
import { createDraftFile } from '@/lib/api/file-state';

interface StepConnectionProps {
  onComplete: (connectionId: number, connectionName: string) => void;
  onStaticSelect?: (tab: 'csv' | 'sheets') => void;
  greeting?: string;
}

export default function StepConnection({ onComplete, onStaticSelect, greeting }: StepConnectionProps) {
  const [draftFileId, setDraftFileId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    createDraftFile('connection').then((id: number) => {
      if (!cancelled) setDraftFileId(id);
    });
    return () => { cancelled = true; };
  }, []);

  if (draftFileId === null) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minH="400px">
        <Spinner size="lg" />
      </Box>
    );
  }

  return (
    <Box w="100%">
      <ConnectionContainerV2
        fileId={draftFileId}
        mode="create"
        onSaveSuccess={onComplete}
        onStaticSelect={onStaticSelect}
        hideCancel
        greeting={greeting}
      />
    </Box>
  );
}
