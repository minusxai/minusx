'use client';

/**
 * AlertRunContainerV2
 * Viewer for alert_run files.
 * Supports both the new RunFileContent shape (Phase 2+) and the legacy AlertRunContent shape.
 */
import { Box, Text, VStack, HStack, Badge } from '@chakra-ui/react';
import { useFile } from '@/lib/hooks/file-state-hooks';
import type { AlertOutput, AlertRunContent, RunFileContent, RunMessageRecord } from '@/lib/types';
import type { FileId } from '@/store/filesSlice';
import type { FileViewMode } from '@/lib/ui/fileComponents';
import { LuArrowLeft, LuBell, LuMail } from 'react-icons/lu';
import Link from 'next/link';
import { preserveParams } from '@/lib/navigation/url-utils';

interface AlertRunContainerV2Props {
  fileId: FileId;
  mode?: FileViewMode;
  /** When true: hides the back-link and removes full-page centering (for inline use). */
  inline?: boolean;
}

type ExecutionStatus = 'running' | 'success' | 'failure' | 'triggered' | 'not_triggered' | 'failed';

function StatusBadge({ status }: { status: ExecutionStatus }) {
  const colorPalette =
    status === 'triggered' || status === 'failure' || status === 'failed' ? 'red' :
    status === 'not_triggered' || status === 'success' ? 'green' :
    'yellow'; // running
  const label =
    status === 'triggered' ? 'TRIGGERED' :
    status === 'not_triggered' ? 'OK' :
    status.toUpperCase();
  return <Badge colorPalette={colorPalette}>{label}</Badge>;
}

function MessageStatusBadge({ status }: { status: RunMessageRecord['status'] }) {
  const colorPalette = status === 'sent' ? 'green' : status === 'failed' ? 'red' : 'yellow';
  return <Badge colorPalette={colorPalette} size="sm">{status.toUpperCase()}</Badge>;
}

export default function AlertRunContainerV2({ fileId, inline }: AlertRunContainerV2Props) {
  const { fileState: file } = useFile(fileId) ?? {};

  if (!file || file.loading) {
    return <Box p={4} color="fg.muted">Loading run details...</Box>;
  }

  if (!file.content) {
    return <Box p={4} color="fg.muted">Run details not available.</Box>;
  }

  // Detect shape: new RunFileContent has job_type field
  const isNewFormat = 'job_type' in file.content;

  if (isNewFormat) {
    const run = file.content as RunFileContent;
    const output = run.output as AlertOutput | undefined;
    const durationMs = run.completedAt
      ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
      : null;

    return (
      <Box p={inline ? 0 : 6} maxW={inline ? undefined : '600px'} mx={inline ? undefined : 'auto'} fontFamily="mono">
        <VStack align="stretch" gap={4}>
          {/* Back link */}
          {!inline && output?.alertId && (
            <HStack gap={1.5}>
              <LuArrowLeft size={14} />
              <Link href={preserveParams(`/f/${output.alertId}`)} style={{ fontSize: '12px', color: 'inherit', opacity: 0.7 }}>
                {output.alertName || `Alert #${output.alertId}`}
              </Link>
            </HStack>
          )}

          {/* Header */}
          <HStack gap={2} align="center">
            <LuBell size={20} />
            <Text fontWeight="700" fontSize="lg">Alert Run</Text>
            <StatusBadge status={run.status === 'success' && output ? output.status : run.status} />
          </HStack>

          {/* Details */}
          <Box p={4} bg="bg.muted" borderRadius="md" border="1px solid" borderColor="border.muted">
            <VStack align="stretch" gap={2.5}>
              {output && (
                <>
                  {output.actualValue !== null && output.actualValue !== undefined && (
                    <HStack justify="space-between">
                      <Text fontSize="sm" color="fg.muted">Actual value</Text>
                      <Text fontSize="sm" fontWeight="600">{output.actualValue}</Text>
                    </HStack>
                  )}
                  <HStack justify="space-between">
                    <Text fontSize="sm" color="fg.muted">Condition</Text>
                    <Text fontSize="sm" fontWeight="600">
                      {output.selector} / {output.function} {output.column ? `(${output.column})` : ''} {output.operator} {output.threshold}
                    </Text>
                  </HStack>
                </>
              )}
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

          {/* Message delivery records */}
          {run.messages && run.messages.length > 0 && (
            <Box p={4} bg="bg.muted" borderRadius="md" border="1px solid" borderColor="border.muted">
              <Text fontSize="sm" fontWeight="600" mb={2}>Notifications</Text>
              <VStack align="stretch" gap={2}>
                {run.messages.map((msg, i) => (
                  <HStack key={i} justify="space-between">
                    <HStack gap={1.5}>
                      <LuMail size={14} />
                      <Text fontSize="sm">{msg.metadata.to.join(', ')}</Text>
                    </HStack>
                    <MessageStatusBadge status={msg.status} />
                  </HStack>
                ))}
              </VStack>
            </Box>
          )}
        </VStack>
      </Box>
    );
  }

  // Legacy AlertRunContent
  const run = file.content as AlertRunContent;
  const durationMs = run.completedAt
    ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
    : null;

  return (
    <Box p={inline ? 0 : 6} maxW={inline ? undefined : '600px'} mx={inline ? undefined : 'auto'} fontFamily="mono">
      <VStack align="stretch" gap={4}>
        {!inline && run.alertId && (
          <HStack gap={1.5}>
            <LuArrowLeft size={14} />
            <Link href={preserveParams(`/f/${run.alertId}`)} style={{ fontSize: '12px', color: 'inherit', opacity: 0.7 }}>
              {run.alertName || `Alert #${run.alertId}`}
            </Link>
          </HStack>
        )}

        <HStack gap={2} align="center">
          <LuBell size={20} />
          <Text fontWeight="700" fontSize="lg">Alert Run</Text>
          <StatusBadge status={run.status} />
        </HStack>

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
