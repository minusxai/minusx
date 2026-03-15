import type { AlertContent } from '@/lib/types';
import type { FileType } from '@/lib/ui/file-metadata';

export interface JobDefinition {
  job_type: string;
  file_type: FileType;
  isActive: (content: any) => boolean;
}

export const JOB_DEFINITIONS: JobDefinition[] = [
  {
    job_type: 'alert',
    file_type: 'alert',
    isActive: (content: AlertContent) => content.status === 'live',
  },
];
