'use client';

import { useEffect, useState } from 'react';
import { Box, Spinner } from '@chakra-ui/react';
import ConnectionContainerV2 from '@/components/containers/ConnectionContainerV2';
import { createVirtualFile } from '@/lib/api/file-state';

interface StepConnectionProps {
  onComplete: (connectionId: number, connectionName: string) => void;
  greeting?: string;
}

export default function StepConnection({ onComplete, greeting }: StepConnectionProps) {
  const [virtualFileId, setVirtualFileId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    createVirtualFile('connection').then((id) => {
      if (!cancelled) setVirtualFileId(id);
    });
    return () => { cancelled = true; };
  }, []);

  if (virtualFileId === null) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minH="400px">
        <Spinner size="lg" />
      </Box>
    );
  }

  return (
    <Box w="100%">
      <ConnectionContainerV2
        fileId={virtualFileId}
        mode="create"
        onSaveSuccess={onComplete}
        hideCancel
        greeting={greeting}
      />
    </Box>
  );
}
