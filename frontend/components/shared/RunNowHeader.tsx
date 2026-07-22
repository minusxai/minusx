'use client';

import { useState } from 'react';
import Link from 'next/link';
import { LuExternalLink, LuHistory, LuPlay } from 'react-icons/lu';
import { Button } from '@/components/kit/button';
import { Switch } from '@/components/kit/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/kit/select';
import { preserveParams } from '@/lib/navigation/url-utils';
import type { JobRun } from '@/lib/types';

export interface RunOptions {
  force: boolean;
  send: boolean;
}

interface RunNowHeaderProps {
  title: string;
  runs: JobRun[];
  selectedRunId?: number | null;
  onSelectRun?: (runId: number | null) => void;
  isRunning: boolean;
  /** Disables the run button (e.g. isDirty, no items configured) */
  disabled: boolean;
  onRunNow: (opts: RunOptions) => void;
  /** Primary button label. Default: "Run Now" */
  buttonLabel?: string;
  /** Primary button loading label. Default: "Running..." */
  runningLabel?: string;
  /** If provided, renders a secondary "Test Only" outline button */
  onTestOnly?: (opts: RunOptions) => void;
  /** If true, shows "Refreshing schema..." indicator */
  schemaRefreshing?: boolean;
  /** If provided, renders an external link icon to /f/{externalLinkId} */
  externalLinkId?: number;
}

export function RunNowHeader({
  title,
  runs,
  selectedRunId,
  onSelectRun,
  isRunning,
  disabled,
  onRunNow,
  buttonLabel = 'Run Now',
  runningLabel = 'Running...',
  onTestOnly,
  schemaRefreshing,
  externalLinkId,
}: RunNowHeaderProps) {
  const [forceRun, setForceRun] = useState(false);
  const [sendNotifications, setSendNotifications] = useState(true);

  const runOptions: RunOptions = { force: forceRun, send: sendNotifications };

  const runItems = runs.filter(r => r.id != null).map(r => ({
    value: String(r.id),
    label: new Date(r.created_at).toLocaleString(),
  }));

  return (
    <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
      <div className="flex flex-1 items-center gap-2">
        <LuHistory size={16} />
        <span className="text-sm font-semibold">{title}</span>
        {runs.length > 0 && (
          <div className="max-w-[200px] flex-1">
            <Select
              value={selectedRunId ? String(selectedRunId) : ''}
              onValueChange={(v) => onSelectRun?.(v ? parseInt(v, 10) : null)}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue placeholder="Select run..." />
              </SelectTrigger>
              <SelectContent>
                {runItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Switch
            checked={forceRun}
            onCheckedChange={(checked: boolean) => setForceRun(checked)}
            className="data-[state=checked]:bg-[#f39c12]"
          />
          <span className="text-xs text-muted-foreground">Force</span>
        </div>

        <div className="flex items-center gap-1.5">
          <Switch
            checked={sendNotifications}
            onCheckedChange={(checked: boolean) => setSendNotifications(checked)}
            className="data-[state=checked]:bg-[#16a085]"
          />
          <span className="text-xs text-muted-foreground">Send</span>
        </div>

        {schemaRefreshing && (
          <span className="text-xs text-muted-foreground italic">Refreshing schema...</span>
        )}

        {externalLinkId && (
          <Link href={preserveParams(`/f/${externalLinkId}`)}>
            <Button size="sm" variant="ghost">
              <LuExternalLink size={14} />
            </Button>
          </Link>
        )}

        {onTestOnly && (
          <Button
            onClick={() => onTestOnly(runOptions)}
            disabled={disabled}
            size="sm"
            variant="outline"
          >
            <LuPlay size={14} />
            {isRunning ? runningLabel : 'Test Only'}
          </Button>
        )}

        <Button
          onClick={() => onRunNow(runOptions)}
          disabled={disabled && !forceRun}
          size="sm"
          className="bg-[#16a085] text-white hover:bg-[#16a085]/90"
        >
          <LuPlay size={14} />
          {isRunning ? runningLabel : buttonLabel}
        </Button>
      </div>
    </div>
  );
}
