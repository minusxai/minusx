import type { ConnectionContent, CsvFileInfo, ScheduledJobContent } from '@/lib/types';
import type { FileType } from '@/lib/ui/file-metadata';

export interface JobDefinition {
  job_type: string;
  file_type: FileType;
  isActive: (content: ScheduledJobContent) => boolean;
  /**
   * Returns the cron expression gating this job, or null when the job has none.
   * When defined, the cron route only fires the job inside its schedule window
   * (and skips it entirely if this returns null). Job types without getCron
   * keep the legacy behavior of running on every cron tick while active.
   */
  getCron?: (content: ScheduledJobContent) => string | null;
}

/** A connection participates in sheets auto-sync when it has an autoSync
 *  schedule and at least one Google Sheets-sourced file to resync. */
function isSheetsSyncActive(content: ScheduledJobContent): boolean {
  const conn = content as unknown as ConnectionContent;
  if (!conn.autoSync?.cron || !conn.config) return false;
  const files = (conn.config.files ?? []) as CsvFileInfo[];
  return files.some((f) => f.source_type === 'google_sheets' && !!f.spreadsheet_id);
}

export const JOB_DEFINITIONS: JobDefinition[] = [
  { job_type: 'alert',          file_type: 'alert',          isActive: (c) => c.status === 'live', getCron: (c) => c.schedule?.cron ?? null },
  { job_type: 'context',        file_type: 'context',        isActive: (c) => c.status === 'live' },
  { job_type: 'report',         file_type: 'report',         isActive: (c) => c.status === 'live' },
  { job_type: 'transformation', file_type: 'transformation', isActive: (c) => c.status === 'live' },
  {
    job_type: 'sheets_sync',
    file_type: 'connection',
    isActive: isSheetsSyncActive,
    getCron: (c) => (c as unknown as ConnectionContent).autoSync?.cron ?? null,
  },
];
