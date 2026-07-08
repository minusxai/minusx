// ============================================================================
// Alerts domain types — split out of lib/types.ts (thin barrel there re-exports
// everything here; see lib/types.ts for the barrel).
//
// NOTE: generic scheduled-job/job-run infrastructure that historically lived
// alongside these (AlertRecipient, RunMessage, MessageAttemptLog,
// RunMessageRecord, RunFileContent, JobHandlerResult) now lives in
// lib/types/jobs.ts instead — see the comment there for why.
// ============================================================================

import type { PartialBy } from '@/lib/types';
import type { BaseFileContent } from './files';
import type { ScheduledJobContent } from './jobs';
import type { Test, TestRunResult } from './evals';

// Alert types
export type AlertSelector = 'first' | 'last' | 'all';
export type AlertFunction =
  // For first/last (single row)
  | 'value'        // raw numeric value
  | 'diff'         // difference vs adjacent row
  | 'pct_change'   // % change vs adjacent row
  | 'months_ago'   // calendar months between value and now
  | 'days_ago'     // calendar days between value and now
  | 'years_ago'    // years between value and now
  // For all (aggregate)
  | 'count'        // row count (no column needed)
  | 'sum'          // sum of column
  | 'avg'          // average of column
  | 'min'          // min of column
  | 'max';         // max of column
export type ComparisonOperator = '>' | '<' | '=' | '>=' | '<=' | '!=';

/** Snapshot of a resolved recipient written to alert run output. */
export interface DeliveredRecipient {
  name: string;
  channel: 'email' | 'phone' | 'slack' | 'slack_app';
  address: string;
}

export type AlertContent = PartialBy<ScheduledJobContent, 'recipients'> & {
  tests: Test[];
  notifyOn?: 'any_fail' | 'all_fail';
};

/** @deprecated Use RunFileContent with output: AlertOutput instead */
export interface AlertRunContent extends BaseFileContent {
  alertId: number;
  alertName: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'triggered' | 'not_triggered' | 'failed';
  actualValue: number | null;
  threshold: number;
  operator: ComparisonOperator;
  selector: AlertSelector;
  function: AlertFunction;
  column?: string;
  error?: string;
}

// Alert-specific output stored inside RunFileContent.output
export interface AlertOutput {
  alertId: number;
  alertName: string;
  status: 'triggered' | 'not_triggered' | 'error';
  testResults: TestRunResult[];
  triggeredBy: TestRunResult[];     // subset that failed (caused trigger)
  deliveredTo?: DeliveredRecipient[]; // snapshot of who was notified (name + channel + address)
}
