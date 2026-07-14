// ============================================================================
// Jobs/transforms domain types — split out of lib/types.ts (thin barrel there
// re-exports everything here; see lib/types.ts for the barrel).
//
// NOTE: AlertRecipient, RunMessage, MessageAttemptLog, RunMessageRecord,
// RunFileContent, and JobHandlerResult are grouped here (not in
// lib/types/alerts.ts, despite the "Alert" naming) because they are generic
// scheduled-job/job-run infrastructure shared by alerts, reports,
// and context evals alike (confirmed by usage: lib/jobs/job-utils.ts,
// lib/messaging/delivery-options.ts, lib/jobs/handlers/*-handler.ts all consume
// them independent of alerts). This avoids an otherwise-unnecessary
// jobs.ts <-> alerts.ts import cycle.
// ============================================================================

import type { BaseFileContent } from './files';
import type { TestRunResult } from './evals';

/** Cron schedule shared by all scheduled job types. */
export type JobSchedule = {
  cron: string;
  timezone: string;
};

/** Recipient stored on an alert — references a user by ID or a named config channel. */
export type AlertRecipient =
  | { userId: number;      channel: 'email' | 'phone' }
  | { channelName: string; channel: 'email' | 'phone' | 'slack' | 'slack_app' };

/** Base content for all scheduled jobs (alerts, reports, context evals). */
export interface ScheduledJobContent extends BaseFileContent {
  description?: string;
  status?: 'live' | 'draft';        // 'live' = runs on cron, 'draft' = manual only
  suppressUntil?: string;           // ISO date "YYYY-MM-DD"; cron skips until end of this date
  schedule: JobSchedule;
  recipients: AlertRecipient[];
}

// Job run types (from job_runs table)
export type JobRunStatus = 'RUNNING' | 'SUCCESS' | 'FAILURE' | 'TIMEOUT';
export type JobRunSource = 'manual' | 'cron';

export interface JobRun {
  id: number;
  created_at: string;
  completed_at: string | null;
  job_id: string;
  job_type: string;
  output_file_id: number | null;    // ID of the result file (e.g. alert_run); navigate via /f/{output_file_id}
  output_file_type: string | null;  // Type of the result file (e.g. 'alert_run')
  status: JobRunStatus;
  error: string | null;
  timeout: number;
  source: JobRunSource;
}

export type RunMessage =
  | { type: 'email_alert';  content: string; metadata: { to: string; subject: string } }
  | { type: 'phone_alert';  content: string; metadata: { to: string; title?: string; desc?: string; link?: string; summary?: string } }
  | { type: 'slack_alert';  content: string; metadata: { channel: string; webhook_url: string; properties?: Record<string, unknown> } }
  | { type: 'slack_app_alert'; content: string; metadata: { channel: string; team_id: string; channel_name?: string } };

export interface MessageAttemptLog {
  attemptedAt: string;
  success: boolean;
  statusCode?: number;
  error?: string;
  requestBody?: string;
  responseBody?: string;
}

export type RunMessageRecord = RunMessage & {
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  sentAt?: string;
  deliveryError?: string;
  logs?: MessageAttemptLog[];
};

// Generic run file content — the stored type for alert_run files in Phase 2+
export interface RunFileContent extends BaseFileContent {
  job_type: string;
  status: 'running' | 'success' | 'failure';
  startedAt: string;
  completedAt?: string;
  error?: string;
  output?: Record<string, any>;
  messages?: RunMessageRecord[];
}

// What handlers return
export interface JobHandlerResult {
  output: Record<string, any>;
  messages: RunMessage[];
  /** Optional override: if 'failure', route marks the run as FAILURE even though handler didn't throw */
  status?: 'success' | 'failure';
}

// Context eval run output stored inside RunFileContent.output
export interface ContextOutput {
  results: TestRunResult[];
}

// What handlers receive
export interface JobRunnerInput {
  runFileId: number;
  jobId: string;
  jobType: string;
  file: any;
  previousRuns: JobRun[];
}
