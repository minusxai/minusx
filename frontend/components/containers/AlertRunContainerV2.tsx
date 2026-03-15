'use client';

/**
 * AlertRunContainerV2
 * Viewer for alert_run files.
 * Loads the alert_run file and renders its result details.
 */
import { Box, Text, VStack, HStack, Badge } from '@chakra-ui/react';
import { useFile } from '@/lib/hooks/file-state-hooks';
import type { AlertRunContent } from '@/lib/types';
import type { FileId } from '@/store/filesSlice';
import type { FileViewMode } from '@/lib/ui/fileComponents';
import { LuArrowLeft, LuBell } from 'react-icons/lu';
import Link from 'next/link';
import { preserveParams } from '@/lib/navigation/url-utils';

interface AlertRunContainerV2Props {
  fileId: FileId;
  mode?: FileViewMode;
  /** When true: hides the back-link and removes full-page centering (for inline use). */
  inline?: boolean;
}

function StatusBadge({ status }: { status: AlertRunContent['status'] }) {
  const colorPalette =
    status === 'triggered' ? 'red' :
    status === 'not_triggered' ? 'green' :
    status === 'failed' ? 'red' : 'yellow';
  const label =
    status === 'triggered' ? 'TRIGGERED' :
    status === 'not_triggered' ? 'OK' :
    status.toUpperCase();
  return <Badge colorPalette={colorPalette}>{label}</Badge>;
}

export default function AlertRunContainerV2({ fileId, inline }: AlertRunContainerV2Props) {
  const { fileState: file } = useFile(fileId) ?? {};

  if (!file || file.loading) {
    return <Box p={4} color="fg.muted">Loading run details...</Box>;
  }

  if (!file.content) {
    return <Box p={4} color="fg.muted">Run details not available.</Box>;
  }

  const run = file.content as AlertRunContent;
  const durationMs = run.completedAt
    ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
    : null;

  return (
    <Box p={inline ? 0 : 6} maxW={inline ? undefined : '600px'} mx={inline ? undefined : 'auto'} fontFamily="mono">
      <VStack align="stretch" gap={4}>
        {/* Back link to parent alert — hidden when rendered inline inside the alert view */}
        {!inline && run.alertId && (
          <HStack gap={1.5}>
            <LuArrowLeft size={14} />
            <Link href={preserveParams(`/f/${run.alertId}`)} style={{ fontSize: '12px', color: 'inherit', opacity: 0.7 }}>
              {run.alertName || `Alert #${run.alertId}`}
            </Link>
          </HStack>
        )}

        {/* Header */}
        <HStack gap={2} align="center">
          <LuBell size={20} />
          <Text fontWeight="700" fontSize="lg">Alert Run</Text>
          <StatusBadge status={run.status} />
        </HStack>

        {/* Details */}
        <Box p={4} bg="bg.muted" borderRadius="md" border="1px solid" borderColor="border.muted">
          <VStack align="stretch" gap={2.5}>
            {run.actualValue !== null && run.actualValue !== undefined && (
              <HStack justify="space-between">
                <Text fontSize="sm" color="fg.muted">Actual value</Text>
                <Text fontSize="sm" fontWeight="600">{run.actualValue}</Text>
              </HStack>
            )}
            <HStack justify="space-between">
              <Text fontSize="sm" color="fg.muted">Condition</Text>
              <Text fontSize="sm" fontWeight="600">
                {run.selector} / {run.function} {run.column ? `(${run.column})` : ''} {run.operator} {run.threshold}
              </Text>
            </HStack>
            <HStack justify="space-between">
              <Text fontSize="sm" color="fg.muted">Started</Text>
              <Text fontSize="sm">{new Date(run.startedAt).toLocaleString()}</Text>
            </HStack>
            {run.completedAt && (
              <HStack justify="space-between">
                <Text fontSize="sm" color="fg.muted">Completed</Text>
                <Text fontSize="sm">{new Date(run.completedAt).toLocaleString()}</Text>
              </HStack>
            )}
            {durationMs !== null && (
              <HStack justify="space-between">
                <Text fontSize="sm" color="fg.muted">Duration</Text>
                <Text fontSize="sm">{Math.round(durationMs / 1000)}s</Text>
              </HStack>
            )}
          </VStack>
        </Box>

        {/* Error */}
        {run.error && (
          <Box p={4} bg="red.subtle" borderRadius="md" color="red.fg">
            <Text fontSize="sm" fontWeight="600" mb={1}>Error</Text>
            <Text fontSize="sm">{run.error}</Text>
          </Box>
        )}
      </VStack>
    </Box>
  );
}
