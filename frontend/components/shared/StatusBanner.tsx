'use client';

/**
 * StatusBanner
 * Live/Draft toggle banner shared by all scheduled job file types:
 * Alert, Report, Transformation, Context (evals).
 */
import { HStack, Text, Switch } from '@chakra-ui/react';
import type { CheckedChangeDetails } from '@zag-js/switch';
import { LuInfo } from 'react-icons/lu';

interface StatusBannerProps {
  status: 'live' | 'draft';
  /** Display name for the file type, e.g. "alert", "report" */
  label: string;
  /** Label for the manual-run action, e.g. "Run Now", "Check Now" */
  runLabel?: string;
  editMode?: boolean;
  onChange: (status: 'live' | 'draft') => void;
}

export function StatusBanner({ status, label, runLabel = 'Run Now', editMode, onChange }: StatusBannerProps) {
  const isLive = status === 'live';
  return (
    <HStack
      gap={3}
      px={4}
      py={2}
      bg={isLive ? 'green.subtle' : 'yellow.subtle'}
      borderBottomWidth="1px"
      borderColor={isLive ? 'green.muted' : 'yellow.muted'}
      borderRadius="md"
    >
      <LuInfo size={14} color={isLive ? 'var(--chakra-colors-green-fg)' : 'var(--chakra-colors-yellow-fg)'} />
      <Text fontSize="xs" color={isLive ? 'green.fg' : 'yellow.fg'} flex={1}>
        {isLive
          ? `This ${label} is live. Scheduled runs will execute when the cron endpoint is triggered.`
          : `Draft mode — scheduled runs are disabled. Use ${runLabel} to test.`}
      </Text>
      <HStack gap={2}>
        <Text fontSize="xs" fontWeight="600" color={isLive ? 'green.fg' : 'yellow.fg'}>
          {isLive ? 'Live' : 'Draft'}
        </Text>
        <Switch.Root
          size="sm"
          checked={isLive}
          disabled={!editMode}
          onCheckedChange={(e: CheckedChangeDetails) => onChange(e.checked ? 'live' : 'draft')}
          colorPalette="green"
        >
          <Switch.HiddenInput />
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Root>
      </HStack>
    </HStack>
  );
}
