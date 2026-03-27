'use client';

/**
 * ReportRunContainerV2
 * Smart container for report run files — standalone page and inline panel.
 */
import { Box, Text, VStack, HStack, Badge } from '@chakra-ui/react';
import { LuExternalLink } from 'react-icons/lu';
import Link from 'next/link';
import { preserveParams } from '@/lib/navigation/url-utils';
import { useFile } from '@/lib/hooks/file-state-hooks';
import Markdown from '@/components/Markdown';
import type { ReportOutput, RunFileContent } from '@/lib/types';
import type { FileId } from '@/store/filesSlice';
import type { FileViewMode } from '@/lib/ui/fileComponents';

interface ReportRunContainerV2Props {
  fileId: FileId;
  mode?: FileViewMode;
  inline?: boolean;
}

export default function ReportRunContainerV2({ fileId, inline }: ReportRunContainerV2Props) {
  const { fileState: file } = useFile(fileId) ?? {};

  if (!file || file.loading) {
    return <Box p={4} color="fg.muted">Loading run details...</Box>;
  }

  if (!file.content) {
    return <Box p={4} color="fg.muted">Run details not available.</Box>;
  }

  const run = file.content as RunFileContent;
  const output = run.output as ReportOutput | undefined;

  const statusColor =
    run.status === 'success' ? 'green' :
    run.status === 'failure' ? 'red' :
    'yellow';

  return (
    <VStack align="stretch" gap={4} p={inline ? 0 : 4}>
      <HStack justify="space-between">
        <HStack gap={2}>
          <Badge colorPalette={statusColor} size="lg" fontWeight="700">
            {run.status.toUpperCase()}
          </Badge>
          <Text fontSize="xs" color="fg.muted">
            {new Date(run.startedAt).toLocaleString()}
          </Text>
          {run.completedAt && (
            <Text fontSize="xs" color="fg.muted">
              → {new Date(run.completedAt).toLocaleString()}
            </Text>
          )}
        </HStack>
        {!inline && typeof fileId === 'number' && (
          <Link href={preserveParams(`/f/${fileId}`)} style={{ opacity: 0.5 }}>
            <LuExternalLink size={14} />
          </Link>
        )}
      </HStack>

      {run.error && (
        <Box p={3} bg="red.subtle" borderRadius="md" color="red.fg">
          <Text fontSize="sm">{run.error}</Text>
        </Box>
      )}

      {output?.generatedReport ? (
        <Box p={4} bg="bg.muted" borderRadius="md">
          <Markdown queries={output.queries}>
            {output.generatedReport}
          </Markdown>
        </Box>
      ) : !run.error && (
        <Text fontSize="sm" color="fg.muted">No report content generated.</Text>
      )}
    </VStack>
  );
}
