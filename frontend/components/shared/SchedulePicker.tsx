'use client';

import { useMemo } from 'react';
import { LuClock } from 'react-icons/lu';
import { Input } from '@/components/kit/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/kit/select';

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
  const cronItems = useMemo(
    () => [...presets, CUSTOM_PRESET],
    [presets]
  );
  const presetValue = presets.some(p => p.value === schedule.cron) ? schedule.cron : '__custom__';

  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-muted p-3 pl-5">
      <div className="absolute top-0 bottom-0 left-0 w-[3px] rounded-l-md bg-[#16a085]" />
      <div className="mb-2 flex items-center gap-1.5">
        <LuClock size={14} color="#16a085" />
        <span className="text-xs font-bold tracking-wider text-muted-foreground uppercase">{title}</span>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-[2]">
          <Select
            value={presetValue}
            onValueChange={(v) => {
              if (v !== '__custom__') {
                onChange({ ...schedule, cron: v });
              }
            }}
            disabled={!editMode}
          >
            <SelectTrigger size="sm" className="w-full bg-card">
              <SelectValue placeholder="Select schedule" />
            </SelectTrigger>
            <SelectContent>
              {cronItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1">
          <Input
            value={schedule.cron}
            onChange={(e) => onChange({ ...schedule, cron: e.target.value })}
            placeholder="cron"
            aria-label="Cron expression"
            disabled={!editMode}
            className="h-8 bg-card font-mono text-xs"
          />
        </div>

        <div className="flex-1">
          <Select
            value={schedule.timezone || 'America/New_York'}
            onValueChange={(v) => onChange({ ...schedule, timezone: v })}
            disabled={!editMode}
          >
            <SelectTrigger size="sm" className="w-full bg-card">
              <SelectValue placeholder="TZ" />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>
                  {tz.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
