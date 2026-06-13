'use client';

import { Box, HStack, Switch, Text, VStack } from '@chakra-ui/react';
import { LuRefreshCw } from 'react-icons/lu';
import { SchedulePicker, type CronPreset } from '@/components/shared/SchedulePicker';
import type { JobSchedule } from '@/lib/types';

const SYNC_PRESETS: CronPreset[] = [
  { value: '0 * * * *',   label: 'Every hour' },
  { value: '0 */3 * * *', label: 'Every 3 hours' },
  { value: '0 */6 * * *', label: 'Every 6 hours' },
  { value: '0 9 * * *',   label: 'Daily at 9am' },
];

const DEFAULT_SYNC_SCHEDULE: JobSchedule = { cron: '0 */3 * * *', timezone: 'UTC' };

interface SheetsAutoSyncSectionProps {
  autoSync?: JobSchedule;
  onChange: (autoSync: JobSchedule | undefined) => void;
  lastSyncedAt?: string;
  lastSyncError?: string;
  editMode?: boolean;
}

/** Auto-sync toggle + schedule + last-sync status for Google Sheets-backed connections. */
export function SheetsAutoSyncSection({
  autoSync,
  onChange,
  lastSyncedAt,
  lastSyncError,
  editMode = true,
}: SheetsAutoSyncSectionProps) {
  const enabled = !!autoSync;

  return (
    <VStack align="stretch" gap={2}>
      <HStack justify="space-between">
        <HStack gap={1.5}>
          <LuRefreshCw size={14} color="var(--chakra-colors-accent-teal)" />
          <VStack align="start" gap={0}>
            <Text fontWeight="700" fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">
              Auto-sync
            </Text>
            <Text fontSize="2xs" color="fg.muted">
              Re-import all Google Sheets in this connection on a schedule
            </Text>
          </VStack>
        </HStack>
        <Switch.Root
          checked={enabled}
          onCheckedChange={(e) => onChange(e.checked ? DEFAULT_SYNC_SCHEDULE : undefined)}
          disabled={!editMode}
          size="sm"
          colorPalette="teal"
        >
          <Switch.HiddenInput aria-label="Toggle auto-sync" />
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Root>
      </HStack>

      {enabled && autoSync && (
        <SchedulePicker
          schedule={autoSync}
          onChange={onChange}
          editMode={editMode}
          presets={SYNC_PRESETS}
          title="Sync schedule"
        />
      )}

      {(lastSyncedAt || lastSyncError) && (
        <Box>
          {lastSyncedAt && (
            <Text aria-label="Last synced" fontSize="2xs" color="fg.muted" fontFamily="mono">
              Last synced {new Date(lastSyncedAt).toLocaleString()}
            </Text>
          )}
          {lastSyncError && (
            <Text aria-label="Last sync error" fontSize="2xs" color="accent.danger" fontFamily="mono">
              Last sync failed: {lastSyncError}
            </Text>
          )}
        </Box>
      )}
    </VStack>
  );
}
