import type { AlertContent, ContextContent, ReportContent, TransformationContent } from '@/lib/types';
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
  {
    job_type: 'context',
    file_type: 'context',
    isActive: (content: ContextContent) => content.status === 'live',
  },
  {
    job_type: 'report',
    file_type: 'report',
    isActive: (content: ReportContent) => content.status === 'live',
  },
  {
    job_type: 'transformation',
    file_type: 'transformation',
    isActive: (content: TransformationContent) => content.status === 'live',
  },
];
