'use client';

import { useMemo } from 'react';
import { Box, Text, HStack, Input, Portal, createListCollection } from '@chakra-ui/react';
import { LuClock } from 'react-icons/lu';
import { SelectRoot, SelectTrigger, SelectPositioner, SelectContent, SelectItem, SelectValueText } from '@/components/ui/select';

export interface CronPreset {
  value: string;
  label: string;
}

const CRON_PRESETS: CronPreset[] = [
  { value: '0 9 * * *',   label: 'Daily at 9am' },
  { value: '0 9 * * 1',   label: 'Weekly on Monday' },
  { value: '0 9 * * 1-5', label: 'Weekdays at 9am' },
  { value: '0 9 1 * *',   label: 'Monthly on 1st' },
  { value: '0 17 * * 5',  label: 'Fridays at 5pm' },
];

const CUSTOM_PRESET: CronPreset = { value: '__custom__', label: 'Custom Schedule' };

const TIMEZONES = [
  { value: 'America/New_York',    label: 'ET' },
  { value: 'America/Chicago',     label: 'CT' },
  { value: 'America/Denver',      label: 'MT' },
  { value: 'America/Los_Angeles', label: 'PT' },
  { value: 'UTC',                 label: 'UTC' },
  { value: 'Europe/London',       label: 'GMT' },
  { value: 'Europe/Paris',        label: 'CET' },
  { value: 'Asia/Tokyo',          label: 'JST' },
  { value: 'Asia/Kolkata',        label: 'IST' },
  { value: 'Asia/Jakarta',        label: 'WIB' },
];

const timezoneCollection = createListCollection({
  items: TIMEZONES.map(tz => ({ value: tz.value, label: tz.label })),
});

interface SchedulePickerProps {
  schedule: { cron: string; timezone: string };
  onChange: (schedule: { cron: string; timezone: string }) => void;
  editMode?: boolean;
  /** Override the cron presets (a "Custom Schedule" entry is always appended). */
  presets?: CronPreset[];
  /** Section title shown in the header chip. */
  title?: string;
}

export function SchedulePicker({ schedule, onChange, editMode = true, presets = CRON_PRESETS, title = 'Schedule' }: SchedulePickerProps) {
  const cronCollection = useMemo(
    () => createListCollection({ items: [...presets, CUSTOM_PRESET] }),
    [presets]
  );
  const presetValue = presets.some(p => p.value === schedule.cron) ? schedule.cron : '__custom__';

  return (
    <Box
      position="relative"
      bg="bg.muted"
      borderRadius="md"
      border="1px solid"
      borderColor="border.muted"
      p={3}
      pl={5}
      overflow="hidden"
    >
      <Box position="absolute" left={0} top={0} bottom={0} width="3px" bg="accent.teal" borderLeftRadius="md" />
      <HStack mb={2} gap={1.5}>
        <LuClock size={14} color="var(--chakra-colors-accent-teal)" />
        <Text fontWeight="700" fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">{title}</Text>
      </HStack>

      <HStack gap={2}>
        <Box flex={2}>
          <SelectRoot
            collection={cronCollection}
            value={[presetValue]}
            onValueChange={(e) => {
              if (e.value[0] !== '__custom__') {
                onChange({ ...schedule, cron: e.value[0] });
              }
            }}
            disabled={!editMode}
            size="sm"
          >
            <SelectTrigger bg="bg.surface">
              <SelectValueText placeholder="Select schedule" />
            </SelectTrigger>
            <Portal>
              <SelectPositioner>
                <SelectContent>
                  {cronCollection.items.map((item) => (
                    <SelectItem key={item.value} item={item}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </SelectPositioner>
            </Portal>
          </SelectRoot>
        </Box>

        <Box flex={1}>
          <Input
            value={schedule.cron}
            onChange={(e) => onChange({ ...schedule, cron: e.target.value })}
            placeholder="cron"
            aria-label="Cron expression"
            disabled={!editMode}
            size="sm"
            fontFamily="mono"
            fontSize="xs"
            bg="bg.surface"
          />
        </Box>

        <Box flex={1}>
          <SelectRoot
            collection={timezoneCollection}
            value={[schedule.timezone || 'America/New_York']}
            onValueChange={(e) => onChange({ ...schedule, timezone: e.value[0] })}
            disabled={!editMode}
            size="sm"
          >
            <SelectTrigger bg="bg.surface">
              <SelectValueText placeholder="TZ" />
            </SelectTrigger>
            <Portal>
              <SelectPositioner>
                <SelectContent>
                  {timezoneCollection.items.map((item) => (
                    <SelectItem key={item.value} item={item}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </SelectPositioner>
            </Portal>
          </SelectRoot>
        </Box>
      </HStack>
    </Box>
  );
}
