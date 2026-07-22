'use client';

/**
 * AlertRunContainerV2 + AlertRunView
 *
 * AlertRunView is the reusable presentation component for alert run data.
 * AlertRunContainerV2 is the smart container that loads file data and delegates to AlertRunView.
 */
import { Fragment, useState, useCallback } from 'react';
import { LuChevronDown, LuChevronRight, LuClock, LuTimer, LuHash } from 'react-icons/lu';
import { FaSlack } from 'react-icons/fa';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { editFile, publishFile } from '@/lib/file-state/file-state';
import type { AlertContent, AlertOutput, AlertRunContent, MessageAttemptLog, RunFileContent, RunMessageRecord, TestRunResult } from '@/lib/types';
import TestRunResultsList from '@/components/evals/TestRunResultsList';
import type { FileId } from '@/store/filesSlice';
import type { FileViewMode } from '@/lib/ui/fileComponents';
import { LuBell, LuCirclePause, LuExternalLink, LuMail, LuMessageCircle, LuSettings } from 'react-icons/lu';
import Link from 'next/link';
import { preserveParams } from '@/lib/navigation/url-utils';
import DatePicker from '@/components/selectors/DatePicker';
import { Badge } from '@/components/kit/badge';
import { Button } from '@/components/kit/button';
import { Separator } from '@/components/kit/separator';
import { cn } from '@/components/kit/cn';

/* ------------------------------------------------------------------ */
/*  Shared sub-components                                              */
/* ------------------------------------------------------------------ */

const mix = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

// Theme accents (lib/ui/theme.ts): primary #2980b9, teal #16a085, warning/orange #f39c12,
// success #2ecc71, danger #c0392b.
const GREEN = '#2ecc71';
const RED = '#c0392b';
const YELLOW = '#f39c12';

/** Status badge tint (Chakra colorPalette subtle-badge equivalent) — matches ReportView's scheme. */
const BADGE_TINT: Record<'green' | 'red' | 'yellow' | 'gray', string> = {
  green: 'border-transparent bg-[color-mix(in_srgb,#2ecc71_18%,transparent)] text-[#27ae60]',
  red: 'border-transparent bg-[color-mix(in_srgb,#c0392b_15%,transparent)] text-[#c0392b]',
  yellow: 'border-transparent bg-[color-mix(in_srgb,#f39c12_18%,transparent)] text-[#f39c12]',
  gray: 'border-transparent bg-muted text-muted-foreground',
};

type ExecutionStatus = 'running' | 'success' | 'failure' | 'triggered' | 'not_triggered' | 'failed' | 'error';

function StatusBadge({ status }: { status: ExecutionStatus | undefined }) {
  const tint =
    status === 'triggered' || status === 'failure' || status === 'failed' ? 'red' :
    status === 'not_triggered' || status === 'success' ? 'green' :
    'yellow';
  const label =
    status === 'triggered' ? 'TRIGGERED' :
    status === 'not_triggered' ? 'OK' :
    status ? status.toUpperCase() : 'UNKNOWN';
  return <Badge className={cn(BADGE_TINT[tint], 'px-2.5 text-sm font-bold')}>{label}</Badge>;
}

function MessageStatusBadge({ status }: { status: RunMessageRecord['status'] | undefined }) {
  const tint = status === 'sent' ? 'green' : status === 'failed' ? 'red' : status === 'skipped' ? 'gray' : 'yellow';
  return <Badge className={BADGE_TINT[tint]}>{status ? status.toUpperCase() : 'UNKNOWN'}</Badge>;
}

function AttemptLogRow({ log }: { log: MessageAttemptLog }) {
  const time = new Date(log.attemptedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <p className="min-w-[55px] text-xs text-muted-foreground">{time}</p>
        <p className={cn('text-xs', log.success ? 'text-[#27ae60]' : 'text-[#c0392b]')}>{log.success ? 'OK' : 'FAILED'}</p>
        {log.statusCode !== undefined && <p className="text-xs">{log.statusCode}</p>}
        {log.error && <p className="text-xs text-[#c0392b]">{log.error}</p>}
      </div>
      {log.requestBody && (
        <div className="ml-[55px]">
          <p className="mb-0.5 text-xs font-semibold text-muted-foreground">Request</p>
          <div className="max-h-[120px] overflow-auto rounded-sm border border-border/60 bg-card p-1.5">
            <p className="whitespace-pre-wrap text-xs text-muted-foreground">{log.requestBody}</p>
          </div>
        </div>
      )}
      {log.responseBody && (
        <div className="ml-[55px]">
          <p className="mb-0.5 text-xs font-semibold text-muted-foreground">Response</p>
          <div className="max-h-[120px] overflow-auto rounded-sm border border-border/60 bg-card p-1.5">
            <p className="whitespace-pre-wrap text-xs text-muted-foreground">{log.responseBody}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function MessageRow({ msg }: { msg: RunMessageRecord }) {
  const [open, setOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const isEmail = msg.type === 'email_alert';
  const isSlackApp = msg.type === 'slack_app_alert';
  const isSlack = msg.type === 'slack_alert' || isSlackApp;
  const address = isSlackApp && msg.metadata.channel_name
    ? `#${msg.metadata.channel_name}`
    : isSlack ? msg.metadata.channel : (msg.metadata as { to: string }).to;
  return (
    <div className="overflow-hidden rounded-md border border-border/60">
      <div
        className="flex cursor-pointer items-center justify-between px-3 py-2 hover:bg-accent"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {open ? <LuChevronDown size={13} /> : <LuChevronRight size={13} />}
          {isEmail ? <LuMail size={13} /> : isSlackApp ? <FaSlack size={13} /> : isSlack ? <LuHash size={13} /> : <LuMessageCircle size={13} />}
          <p className="truncate text-sm">{address}</p>
        </div>
        <MessageStatusBadge status={msg.status} />
      </div>
      {open && (
        <div className="border-t border-border/60 bg-muted px-3 py-2">
          <div className="flex flex-col gap-2">
            {isEmail && (
              <div className="flex items-center gap-2">
                <p className="min-w-[55px] text-xs font-semibold text-muted-foreground">Subject</p>
                <p className="text-xs">{(msg.metadata as { to: string; subject: string }).subject}</p>
              </div>
            )}
            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">Body</p>
              {msg.content.trimStart().startsWith('<!DOCTYPE') || msg.content.trimStart().startsWith('<html') ? (
                <div className="overflow-hidden rounded-sm border border-border/60">
                  <iframe
                    srcDoc={msg.content}
                    style={{ width: '100%', height: '500px', border: 'none', background: '#fff' }}
                    sandbox=""
                    title="Email preview"
                  />
                </div>
              ) : (
                <div className="max-h-[200px] overflow-auto rounded-sm border border-border/60 bg-card p-2">
                  <p className="whitespace-pre-wrap text-xs">{msg.content}</p>
                </div>
              )}
            </div>
            {msg.deliveryError && (
              <div className="flex items-center gap-2">
                <p className="min-w-[55px] text-xs font-semibold text-muted-foreground">Error</p>
                <p className="text-xs text-[#c0392b]">{msg.deliveryError}</p>
              </div>
            )}
            {msg.sentAt && (
              <div className="flex items-center gap-2">
                <p className="min-w-[55px] text-xs font-semibold text-muted-foreground">Sent at</p>
                <p className="text-xs">{new Date(msg.sentAt).toLocaleString()}</p>
              </div>
            )}
            {msg.logs && msg.logs.length > 0 && (
              <div>
                <div className="flex cursor-pointer items-center gap-2" onClick={() => setLogsOpen(o => !o)}>
                  <p className="min-w-[55px] text-xs font-semibold text-muted-foreground">Logs</p>
                  {logsOpen ? <LuChevronDown size={11} /> : <LuChevronRight size={11} />}
                  {!logsOpen && <p className="text-xs text-muted-foreground">{msg.logs.length} attempt{msg.logs.length !== 1 ? 's' : ''}</p>}
                </div>
                {logsOpen && (
                  <div className="mt-1 flex flex-col gap-0.5 pl-1">
                    {msg.logs.map((log, i) => <AttemptLogRow key={i} log={log} />)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2">
      <p className="text-sm text-muted-foreground">{label}</p>
      {typeof value === 'string' ? <p className="text-sm font-medium">{value}</p> : value}
    </div>
  );
}

function TimingChip({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs"
      style={{ background: mix(color, 8), border: `1px solid ${mix(color, 20)}` }}
    >
      <span style={{ color }}>{icon}</span>
      <p className="font-bold" style={{ color }}>{label}</p>
      <p className="font-medium text-foreground">{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AlertRunView — reusable presentation component                     */
/* ------------------------------------------------------------------ */

interface AlertRunViewProps {
  status: ExecutionStatus;
  alertId?: number;
  alertName?: string;
  /** Legacy: numeric actual value (old format) */
  actualValue?: number | string | null;
  /** Legacy: condition summary string (old format) */
  condition?: string;
  /** New format: all test results */
  testResults?: TestRunResult[];
  /** New format: tests that failed/triggered the alert */
  triggeredBy?: TestRunResult[];
  startedAt: string;
  completedAt?: string | null;
  error?: string | null;
  messages?: RunMessageRecord[];
  fileId: FileId;
  inline?: boolean;
  /** Current suppressUntil value from the parent alert */
  suppressUntil?: string;
  /** Called with a date string to snooze, or '' to clear */
  onSnooze?: (value: string) => void;
}

function AlertRunView({
  status,
  alertId,
  alertName,
  actualValue,
  condition,
  testResults,
  triggeredBy,
  startedAt,
  completedAt,
  error,
  messages,
  fileId,
  inline,
  suppressUntil,
  onSnooze,
}: AlertRunViewProps) {
  const durationMs = completedAt
    ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
    : null;

  const isTriggered = status === 'triggered' || status === 'failure' || status === 'failed';

  // Legacy detail rows (rendered with separators between visible rows,
  // mirroring Chakra VStack's `separator` prop).
  const detailRows: React.ReactNode[] = [];
  if (actualValue != null) {
    detailRows.push(
      <DetailRow label="Actual value" value={
        <Badge className={cn(BADGE_TINT[isTriggered ? 'red' : 'green'], 'font-mono text-sm font-bold')}>
          {String(actualValue)}
        </Badge>
      } />
    );
  }
  if (condition) {
    detailRows.push(
      <DetailRow label="Condition" value={
        <p className="font-mono text-sm font-semibold">{condition}</p>
      } />
    );
  }
  detailRows.push(
    <DetailRow label="Status" value={
      <Badge className={cn(BADGE_TINT[isTriggered ? 'red' : status === 'not_triggered' || status === 'success' ? 'green' : 'yellow'], 'font-bold')}>
        {status === 'triggered' ? 'Triggered' :
         status === 'not_triggered' ? 'Not Triggered' :
         status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown'}
      </Badge>
    } />
  );

  return (
    <div className={cn(!inline && 'mx-auto mt-6 max-w-[560px] p-8', inline && 'p-0')}>
      <div className="flex flex-col gap-5">
        {/* Header: icon + title + badge */}
        <div className="flex items-center gap-3">
          <div
            className="rounded-lg p-2"
            style={{ background: mix(isTriggered ? RED : status === 'not_triggered' || status === 'success' ? GREEN : YELLOW, 15) }}
          >
            <LuBell size={22} />
          </div>
          <div className="flex flex-col items-start">
            <p className="font-mono text-xl font-extrabold tracking-[-0.02em]">Alert Run</p>
          </div>
          <div className="ml-auto">
            <StatusBadge status={status} />
          </div>
          {inline && (
            <Link href={preserveParams(`/f/${fileId}`)} style={{ opacity: 0.5 }}>
              <LuExternalLink size={14} />
            </Link>
          )}
        </div>

        {/* Alert config link button */}
        {!inline && alertId && (
          <Link href={preserveParams(`/f/${alertId}`)} style={{ textDecoration: 'none' }}>
            <div className="flex cursor-pointer items-center gap-2 rounded-lg border border-[color-mix(in_srgb,#9b59b6_25%,transparent)] bg-[color-mix(in_srgb,#9b59b6_10%,transparent)] px-3 py-2.5 transition-all duration-150 hover:border-[color-mix(in_srgb,#9b59b6_40%,transparent)] hover:bg-[color-mix(in_srgb,#9b59b6_15%,transparent)]">
              <LuSettings size={14} color="#9b59b6" />
              <p className="text-sm font-semibold text-[#9b59b6]">View Alert Config</p>
              <p className="text-sm text-muted-foreground">{alertName || `Alert #${alertId}`}</p>
            </div>
          </Link>
        )}

        {/* Run details card */}
        <div className="rounded-lg border border-border/60 bg-muted p-5">
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Result
          </p>

          {testResults && testResults.length > 0 ? (
            <TestRunResultsList results={testResults} variant="colored" />
          ) : (
            <div className="flex flex-col">
              {detailRows.map((row, i) => (
                <Fragment key={i}>
                  {i > 0 && <Separator />}
                  {row}
                </Fragment>
              ))}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-[color-mix(in_srgb,#c0392b_30%,transparent)] bg-[color-mix(in_srgb,#c0392b_10%,transparent)] p-4 text-[#c0392b]">
            <p className="mb-1 text-sm font-bold">Error</p>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Notifications */}
        {messages && messages.length > 0 && (
          <div className="rounded-lg border border-border/60 bg-muted p-5">
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Notifications
            </p>
            <div className="flex flex-col gap-2">
              {messages.map((msg, i) => (
                <MessageRow key={i} msg={msg} />
              ))}
            </div>
          </div>
        )}

        {/* Timing chips */}
        <div className="flex flex-wrap items-center gap-2">
          <TimingChip
            icon={<LuClock size={12} />}
            label="Started"
            value={new Date(startedAt).toLocaleString()}
            color="#2980b9"
          />
          {completedAt && (
            <TimingChip
              icon={<LuClock size={12} />}
              label="Completed"
              value={new Date(completedAt).toLocaleString()}
              color="#16a085"
            />
          )}
          {durationMs !== null && (
            <TimingChip
              icon={<LuTimer size={12} />}
              label="Duration"
              value={`${Math.round(durationMs / 1000)}s`}
              color="#f39c12"
            />
          )}
        </div>

        {/* Snooze section — only shown on standalone (non-inline) alert runs with a parent alert */}
        {!inline && onSnooze && (
          <SnoozeSection suppressUntil={suppressUntil} onSnooze={onSnooze} />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SnoozeSection                                                      */
/* ------------------------------------------------------------------ */

function isSuppressActive(suppressUntil: string | undefined): boolean {
  if (!suppressUntil) return false;
  const end = new Date(suppressUntil);
  end.setHours(23, 59, 59, 999);
  return end >= new Date();
}

function SnoozeSection({ suppressUntil, onSnooze }: { suppressUntil?: string; onSnooze: (value: string) => void }) {
  const [pendingDate, setPendingDate] = useState('');
  const suppressed = isSuppressActive(suppressUntil);

  // Parse as local date to avoid timezone off-by-one
  const suppressedDisplay = (() => {
    if (!suppressUntil) return '';
    const [y, m, d] = suppressUntil.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  })();

  return (
    <div className="rounded-lg border border-border/60 bg-muted p-5">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <LuCirclePause size={14} color={suppressed ? '#e67e22' : 'var(--muted-foreground)'} />
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {suppressed ? `Snoozed until ${suppressedDisplay}` : 'Snooze this alert'}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {suppressed
            ? 'Scheduled runs will be skipped until this date. Manual runs are not affected.'
            : 'Pause scheduled runs for this alert until a specific date.'}
        </p>
        <div className="flex items-center gap-2">
          {suppressed ? (
            <Button
              aria-label="Clear snooze"
              size="sm"
              className="bg-[#f39c12] text-white hover:bg-[#e67e22]"
              onClick={() => onSnooze('')}
            >
              Clear Snooze
            </Button>
          ) : (
            <>
              <DatePicker
                value={pendingDate || undefined}
                onChange={setPendingDate}
                placeholder="Pick a date"
                ariaLabel="Snooze until date"
              />
              <Button
                aria-label="Confirm snooze"
                size="sm"
                className="bg-[#f39c12] text-white hover:bg-[#e67e22]"
                disabled={!pendingDate}
                onClick={() => { if (pendingDate) { onSnooze(pendingDate); setPendingDate(''); } }}
              >
                Snooze
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
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

  // Extract parent alert ID from run content
  const parentAlertId = (() => {
    if (!file?.content) return undefined;
    if ('job_type' in file.content) {
      return (file.content as RunFileContent).output?.alertId;
    }
    return (file.content as AlertRunContent).alertId;
  })();

  // Load the parent alert to read/update its suppressUntil
  const { fileState: parentAlert } = useFile(parentAlertId ?? undefined) ?? {};
  const parentContent = parentAlert?.content as AlertContent | undefined;

  const handleSnooze = useCallback(async (value: string) => {
    if (!parentAlertId) return;
    editFile({ fileId: parentAlertId, changes: { content: { suppressUntil: value } } });
    await publishFile({ fileId: parentAlertId });
  }, [parentAlertId]);

  if (!file || file.loading) {
    return <div className="p-4 text-muted-foreground">Loading run details...</div>;
  }

  if (!file.content) {
    return <div className="p-4 text-muted-foreground">Run details not available.</div>;
  }

  const snoozeProps = parentAlertId ? {
    suppressUntil: parentContent?.suppressUntil,
    onSnooze: handleSnooze,
  } : {};

  // Detect shape: new RunFileContent has job_type field
  const isNewFormat = 'job_type' in file.content;

  if (isNewFormat) {
    const run = file.content as RunFileContent;
    const output = run.output as AlertOutput | undefined;

    return (
      <AlertRunView
        status={run.status === 'success' && output ? output.status : run.status as ExecutionStatus}
        alertId={output?.alertId}
        alertName={output?.alertName}
        testResults={output?.testResults}
        triggeredBy={output?.triggeredBy}
        startedAt={run.startedAt}
        completedAt={run.completedAt}
        error={run.error}
        messages={run.messages}
        fileId={fileId}
        inline={inline}
        {...snoozeProps}
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
      {...snoozeProps}
    />
  );
}
