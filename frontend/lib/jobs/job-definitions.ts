import type { ScheduledJobContent } from '@/lib/types';
import type { DatasetContent } from '@/lib/types/datasets';
import type { FileType } from '@/lib/ui/file-metadata';

export interface JobDefinition {
  job_type: string;
  file_type: FileType;
  isActive: (content: ScheduledJobContent) => boolean;
  /**
   * Cron expression gating this job (null → skip). Without getCron, the job runs
   * on every cron tick while active. This only extracts the expression *string*
   * from the job's content shape (e.g. `alert.schedule.cron`); the expression is
   * evaluated by `isCronDue`/`getPrevFireTime` in `lib/jobs/cron.ts`, which
   * `lib/jobs/cron-scan.ts` calls with the string this hook returns.
   */
  getCron?: (content: ScheduledJobContent) => string | null;
}

function isSheetsSyncActive(content: ScheduledJobContent): boolean {
  const ds = content as unknown as DatasetContent;
  if (!ds.autoSync?.cron) return false;
  return (ds.files ?? []).some((t) => t.source === 'link' && !!t.source_group);
}

export const JOB_DEFINITIONS: JobDefinition[] = [
  { job_type: 'alert',          file_type: 'alert',          isActive: (c) => c.status === 'live', getCron: (c) => c.schedule?.cron ?? null },
  { job_type: 'context',        file_type: 'context',        isActive: (c) => c.status === 'live' },
  { job_type: 'report',         file_type: 'report',         isActive: (c) => c.status === 'live' },
  {
    job_type: 'sheets_sync',
    file_type: 'dataset',
    isActive: isSheetsSyncActive,
    getCron: (c) => (c as unknown as DatasetContent).autoSync?.cron ?? null,
  },
];
