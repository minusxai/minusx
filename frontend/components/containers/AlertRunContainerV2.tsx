'use client';

/**
 * AlertRunContainerV2 + AlertRunView
 *
 * AlertRunView is the reusable presentation component for alert run data.
 * AlertRunContainerV2 is the smart container that loads file data and delegates to AlertRunView.
 */
import { Box, Text, VStack, HStack, Badge, Separator } from '@chakra-ui/react';
import { useState } from 'react';
import { LuChevronDown, LuChevronRight, LuClock, LuTimer } from 'react-icons/lu';
import { useFile } from '@/lib/hooks/file-state-hooks';
import type { AlertOutput, AlertRunContent, MessageAttemptLog, RunFileContent, RunMessageRecord } from '@/lib/types';
import type { FileId } from '@/store/filesSlice';
import type { FileViewMode } from '@/lib/ui/fileComponents';
import { LuBell, LuExternalLink, LuMail, LuMessageCircle, LuSettings } from 'react-icons/lu';
import Link from 'next/link';
import { preserveParams } from '@/lib/navigation/url-utils';

/* ------------------------------------------------------------------ */
/*  Shared sub-components                                              */
/* ------------------------------------------------------------------ */

type ExecutionStatus = 'running' | 'success' | 'failure' | 'triggered' | 'not_triggered' | 'failed';

function StatusBadge({ status }: { status: ExecutionStatus }) {
  const colorPalette =
    status === 'triggered' || status === 'failure' || status === 'failed' ? 'red' :
    status === 'not_triggered' || status === 'success' ? 'green' :
    'yellow';
  const label =
    status === 'triggered' ? 'TRIGGERED' :
    status === 'not_triggered' ? 'OK' :
    status.toUpperCase();
  return <Badge colorPalette={colorPalette} size="lg" fontWeight="700">{label}</Badge>;
}

function MessageStatusBadge({ status }: { status: RunMessageRecord['status'] }) {
  const colorPalette = status === 'sent' ? 'green' : status === 'failed' ? 'red' : status === 'skipped' ? 'gray' : 'yellow';
  return <Badge colorPalette={colorPalette} size="sm">{status.toUpperCase()}</Badge>;
}

function AttemptLogRow({ log }: { log: MessageAttemptLog }) {
  const time = new Date(log.attemptedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <VStack align="stretch" gap={0.5}>
      <HStack gap={2}>
        <Text fontSize="xs" color="fg.muted" minW="55px">{time}</Text>
        <Text fontSize="xs" color={log.success ? 'green.fg' : 'red.fg'}>{log.success ? 'OK' : 'FAILED'}</Text>
        {log.statusCode !== undefined && <Text fontSize="xs">{log.statusCode}</Text>}
        {log.error && <Text fontSize="xs" color="red.fg">{log.error}</Text>}
      </HStack>
      {log.requestBody && (
        <Box ml="55px">
          <Text fontSize="xs" color="fg.muted" fontWeight="600" mb={0.5}>Request</Text>
          <Box p={1.5} bg="bg.surface" borderRadius="sm" border="1px solid" borderColor="border.muted" maxH="120px" overflow="auto">
            <Text fontSize="xs" whiteSpace="pre-wrap" color="fg.muted">{log.requestBody}</Text>
          </Box>
        </Box>
      )}
      {log.responseBody && (
        <Box ml="55px">
          <Text fontSize="xs" color="fg.muted" fontWeight="600" mb={0.5}>Response</Text>
          <Box p={1.5} bg="bg.surface" borderRadius="sm" border="1px solid" borderColor="border.muted" maxH="120px" overflow="auto">
            <Text fontSize="xs" whiteSpace="pre-wrap" color="fg.muted">{log.responseBody}</Text>
          </Box>
        </Box>
      )}
    </VStack>
  );
}

function MessageRow({ msg }: { msg: RunMessageRecord }) {
  const [open, setOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const isEmail = msg.type === 'email_alert';
  return (
    <Box borderRadius="md" border="1px solid" borderColor="border.muted" overflow="hidden">
      <HStack
        px={3}
        py={2}
        justify="space-between"
        cursor="pointer"
        onClick={() => setOpen(o => !o)}
        _hover={{ bg: 'bg.subtle' }}
      >
        <HStack gap={1.5} flex={1} minW={0}>
          {open ? <LuChevronDown size={13} /> : <LuChevronRight size={13} />}
          {isEmail ? <LuMail size={13} /> : <LuMessageCircle size={13} />}
          <Text fontSize="sm" truncate>{msg.metadata.to}</Text>
        </HStack>
        <MessageStatusBadge status={msg.status} />
      </HStack>
      {open && (
        <Box px={3} py={2} bg="bg.muted" borderTopWidth="1px" borderColor="border.muted">
          <VStack align="stretch" gap={2}>
            {isEmail && (
              <HStack gap={2}>
                <Text fontSize="xs" color="fg.muted" minW="55px" fontWeight="600">Subject</Text>
                <Text fontSize="xs">{(msg.metadata as { to: string; subject: string }).subject}</Text>
              </HStack>
            )}
            <Box>
              <Text fontSize="xs" color="fg.muted" fontWeight="600" mb={1}>Body</Text>
              {msg.content.trimStart().startsWith('<!DOCTYPE') || msg.content.trimStart().startsWith('<html') ? (
                <Box
                  borderRadius="sm"
                  border="1px solid"
                  borderColor="border.muted"
                  overflow="hidden"
                >
                  <iframe
                    srcDoc={msg.content}
                    style={{ width: '100%', height: '500px', border: 'none', background: '#fff' }}
                    sandbox=""
                    title="Email preview"
                  />
                </Box>
              ) : (
                <Box
                  p={2}
                  bg="bg.surface"
                  borderRadius="sm"
                  border="1px solid"
                  borderColor="border.muted"
                  maxH="200px"
                  overflow="auto"
                >
                  <Text fontSize="xs" whiteSpace="pre-wrap">{msg.content}</Text>
                </Box>
              )}
            </Box>
            {msg.deliveryError && (
              <HStack gap={2}>
                <Text fontSize="xs" color="fg.muted" minW="55px" fontWeight="600">Error</Text>
                <Text fontSize="xs" color="red.fg">{msg.deliveryError}</Text>
              </HStack>
            )}
            {msg.sentAt && (
              <HStack gap={2}>
                <Text fontSize="xs" color="fg.muted" minW="55px" fontWeight="600">Sent at</Text>
                <Text fontSize="xs">{new Date(msg.sentAt).toLocaleString()}</Text>
              </HStack>
            )}
            {msg.logs && msg.logs.length > 0 && (
              <Box>
                <HStack gap={2} cursor="pointer" onClick={() => setLogsOpen(o => !o)}>
                  <Text fontSize="xs" color="fg.muted" minW="55px" fontWeight="600">Logs</Text>
                  {logsOpen ? <LuChevronDown size={11} /> : <LuChevronRight size={11} />}
                  {!logsOpen && <Text fontSize="xs" color="fg.muted">{msg.logs.length} attempt{msg.logs.length !== 1 ? 's' : ''}</Text>}
                </HStack>
                {logsOpen && (
                  <VStack align="stretch" gap={0.5} mt={1} pl={1}>
                    {msg.logs.map((log, i) => <AttemptLogRow key={i} log={log} />)}
                  </VStack>
                )}
              </Box>
            )}
          </VStack>
        </Box>
      )}
    </Box>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <HStack justify="space-between" py={2}>
      <Text fontSize="sm" color="fg.muted">{label}</Text>
      {typeof value === 'string' ? <Text fontSize="sm" fontWeight="500">{value}</Text> : value}
    </HStack>
  );
}

function TimingChip({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <HStack
      gap={1.5}
      px={2.5}
      py={1.5}
      bg={`${color}/8`}
      borderRadius="md"
      border="1px solid"
      borderColor={`${color}/20`}
      fontSize="xs"
    >
      <Box color={color}>{icon}</Box>
      <Text fontWeight="700" color={color}>{label}</Text>
      <Text color="fg.default" fontWeight="500">{value}</Text>
    </HStack>
  );
}

/* ------------------------------------------------------------------ */
/*  AlertRunView — reusable presentation component                     */
/* ------------------------------------------------------------------ */

export interface AlertRunViewProps {
  status: ExecutionStatus;
  alertId?: number;
  alertName?: string;
  actualValue?: number | string | null;
  condition: string;
  startedAt: string;
  completedAt?: string | null;
  error?: string | null;
  messages?: RunMessageRecord[];
  fileId: FileId;
  inline?: boolean;
}

export function AlertRunView({
  status,
  alertId,
  alertName,
  actualValue,
  condition,
  startedAt,
  completedAt,
  error,
  messages,
  fileId,
  inline,
}: AlertRunViewProps) {
  const durationMs = completedAt
    ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
    : null;

  const isTriggered = status === 'triggered' || status === 'failure' || status === 'failed';

  return (
    <Box
      p={inline ? 0 : 8}
      maxW={inline ? undefined : '560px'}
      mx={inline ? undefined : 'auto'}
      mt={inline ? 0 : 6}
    >
      <VStack align="stretch" gap={5}>
        {/* Header: icon + title + badge */}
        <HStack gap={3} align="center">
          <Box
            p={2}
            borderRadius="lg"
            bg={isTriggered ? 'red.subtle' : status === 'not_triggered' || status === 'success' ? 'green.subtle' : 'yellow.subtle'}
          >
            <LuBell size={22} />
          </Box>
          <VStack align="start" gap={0}>
            <Text fontWeight="800" fontSize="xl" fontFamily="mono" letterSpacing="-0.02em">Alert Run</Text>
          </VStack>
          <Box ml="auto">
            <StatusBadge status={status} />
          </Box>
          {inline && (
            <Link href={preserveParams(`/f/${fileId}`)} style={{ opacity: 0.5 }}>
              <LuExternalLink size={14} />
            </Link>
          )}
        </HStack>

        {/* Alert config link button */}
        {!inline && alertId && (
          <Link href={preserveParams(`/f/${alertId}`)} style={{ textDecoration: 'none' }}>
            <HStack
              gap={2}
              px={3}
              py={2.5}
              borderRadius="lg"
              bg="accent.secondary/10"
              border="1px solid"
              borderColor="accent.secondary/25"
              cursor="pointer"
              _hover={{ bg: 'accent.secondary/15', borderColor: 'accent.secondary/40' }}
              transition="all 0.15s"
            >
              <LuSettings size={14} color="var(--chakra-colors-accent-secondary)" />
              <Text fontSize="sm" fontWeight="600" color="accent.secondary">View Alert Config</Text>
              <Text fontSize="sm" color="fg.muted">{alertName || `Alert #${alertId}`}</Text>
            </HStack>
          </Link>
        )}

        {/* Run details card */}
        <Box
          p={5}
          bg="bg.muted"
          borderRadius="lg"
          border="1px solid"
          borderColor="border.muted"
        >
          <Text fontSize="xs" fontWeight="700" color="fg.muted" textTransform="uppercase" letterSpacing="0.05em" mb={3}>
            Result
          </Text>
          <VStack align="stretch" gap={0} separator={<Separator />}>
            {actualValue !== null && actualValue !== undefined && (
              <DetailRow label="Actual value" value={
                <Badge
                  colorPalette={isTriggered ? 'red' : 'green'}
                  variant="subtle"
                  fontFamily="mono"
                  fontSize="sm"
                  fontWeight="700"
                >
                  {String(actualValue)}
                </Badge>
              } />
            )}
            <DetailRow label="Condition" value={
              <Text fontSize="sm" fontWeight="600" fontFamily="mono">{condition}</Text>
            } />
            <DetailRow label="Status" value={
              <Badge
                colorPalette={isTriggered ? 'red' : status === 'not_triggered' || status === 'success' ? 'green' : 'yellow'}
                variant="subtle"
                fontWeight="700"
              >
                {status === 'triggered' ? 'Triggered' :
                 status === 'not_triggered' ? 'Not Triggered' :
                 status.charAt(0).toUpperCase() + status.slice(1)}
              </Badge>
            } />
          </VStack>
        </Box>

        {/* Error */}
        {error && (
          <Box p={4} bg="red.subtle" borderRadius="lg" color="red.fg" border="1px solid" borderColor="red.muted">
            <Text fontSize="sm" fontWeight="700" mb={1}>Error</Text>
            <Text fontSize="sm">{error}</Text>
          </Box>
        )}

        {/* Notifications */}
        {messages && messages.length > 0 && (
          <Box
            p={5}
            bg="bg.muted"
            borderRadius="lg"
            border="1px solid"
            borderColor="border.muted"
          >
            <Text fontSize="xs" fontWeight="700" color="fg.muted" textTransform="uppercase" letterSpacing="0.05em" mb={3}>
              Notifications
            </Text>
            <VStack align="stretch" gap={2}>
              {messages.map((msg, i) => (
                <MessageRow key={i} msg={msg} />
              ))}
            </VStack>
          </Box>
        )}

        {/* Timing chips */}
        <HStack gap={2} flexWrap="wrap">
          <TimingChip
            icon={<LuClock size={12} />}
            label="Started"
            value={new Date(startedAt).toLocaleString()}
            color="accent.primary"
          />
          {completedAt && (
            <TimingChip
              icon={<LuClock size={12} />}
              label="Completed"
              value={new Date(completedAt).toLocaleString()}
              color="accent.teal"
            />
          )}
          {durationMs !== null && (
            <TimingChip
              icon={<LuTimer size={12} />}
              label="Duration"
              value={`${Math.round(durationMs / 1000)}s`}
              color="accent.warning"
            />
          )}
        </HStack>
      </VStack>
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  AlertRunContainerV2 — smart container                              */
/* ------------------------------------------------------------------ */

interface AlertRunContainerV2Props {
  fileId: FileId;
  mode?: FileViewMode;
  inline?: boolean;
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

    return (
      <AlertRunView
        status={run.status === 'success' && output ? output.status : run.status}
        alertId={output?.alertId}
        alertName={output?.alertName}
        actualValue={output?.actualValue}
        condition={output ? `${output.selector} / ${output.function} ${output.column ? `(${output.column})` : ''} ${output.operator} ${output.threshold}` : ''}
        startedAt={run.startedAt}
        completedAt={run.completedAt}
        error={run.error}
        messages={run.messages}
        fileId={fileId}
        inline={inline}
      />
    );
  }

  // Legacy AlertRunContent
  const run = file.content as AlertRunContent;

  return (
    <AlertRunView
      status={run.status}
      alertId={run.alertId}
      alertName={run.alertName}
      actualValue={run.actualValue}
      condition={`${run.selector} / ${run.function} ${run.column ? `(${run.column})` : ''} ${run.operator} ${run.threshold}`}
      startedAt={run.startedAt}
      completedAt={run.completedAt}
      error={run.error}
      fileId={fileId}
      inline={inline}
    />
  );
}
