'use client';

/**
 * TransformationRunContainerV2
 * Smart container for transformation run files (standalone view).
 */
import { Box } from '@chakra-ui/react';
import { useFile } from '@/lib/hooks/file-state-hooks';
import type { RunFileContent } from '@/lib/types';
import type { FileId } from '@/store/filesSlice';
import type { FileViewMode } from '@/lib/ui/fileComponents';
import TransformationRunView from '@/components/views/TransformationRunView';

interface TransformationRunContainerV2Props {
  fileId: FileId;
  mode?: FileViewMode;
  inline?: boolean;
}

export default function TransformationRunContainerV2({ fileId, inline }: TransformationRunContainerV2Props) {
  const { fileState: file } = useFile(fileId) ?? {};

  if (!file || file.loading) {
    return <Box p={4} color="fg.muted">Loading run details...</Box>;
  }

  if (!file.content) {
    return <Box p={4} color="fg.muted">Run details not available.</Box>;
  }

  const run = file.content as RunFileContent;

  return <TransformationRunView run={run} inline={inline} />;
}
