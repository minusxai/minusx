import type { ScheduledJobContent } from '@/lib/types';
import type { FileType } from '@/lib/ui/file-metadata';

export interface JobDefinition {
  job_type: string;
  file_type: FileType;
  isActive: (content: ScheduledJobContent) => boolean;
}

export const JOB_DEFINITIONS: JobDefinition[] = [
  { job_type: 'alert',          file_type: 'alert',          isActive: (c) => c.status === 'live' },
  { job_type: 'context',        file_type: 'context',        isActive: (c) => c.status === 'live' },
  { job_type: 'report',         file_type: 'report',         isActive: (c) => c.status === 'live' },
  { job_type: 'transformation', file_type: 'transformation', isActive: (c) => c.status === 'live' },
];
