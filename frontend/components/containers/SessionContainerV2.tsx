'use client';

import { useRouter } from '@/lib/navigation/use-navigation';
import { useFile } from '@/lib/hooks/useFile';
import { Box, Spinner, Text } from '@chakra-ui/react';
import SessionPlayer from '@/components/SessionPlayer';
import { SessionRecordingFileContent } from '@/lib/types';
import { FileComponentProps } from '@/lib/ui/fileComponents';

export default function SessionContainerV2({ fileId }: FileComponentProps) {
  const router = useRouter();
  const { file, loading, error } = useFile(fileId);

  if (loading) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" minH="400px">
        <Spinner size="lg" />
      </Box>
    );
  }

  if (error || !file) {
    return (
      <Box p={8}>
        <Text fontSize="lg" color="accent.danger" fontWeight="semibold">
          {error?.message || 'Recording not found'}
        </Text>
      </Box>
    );
  }

  const content = file.content as SessionRecordingFileContent;

  const handleDelete = () => {
    // Navigate to recordings list after deletion
    router.push('/recordings');
  };

  // Convert fileId to number
  const numericFileId = typeof fileId === 'number' ? fileId : Number(fileId);

  return (
    <SessionPlayer
      content={content}
      fileName={file.name}
      fileId={numericFileId}
      onDelete={handleDelete}
    />
  );
}
