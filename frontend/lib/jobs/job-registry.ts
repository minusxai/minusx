import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { BaseFileContent } from '@/lib/types';
import type { FileType } from '@/lib/ui/file-metadata';
import { alertJobHandler } from './handlers/alert-handler';

export interface JobResult {
  status: 'SUCCESS' | 'FAILURE';
  content: BaseFileContent;
  file_type: FileType;
}

export interface JobHandler {
  execute(
    jobId: string,
    jobContent: any,
    user: EffectiveUser,
    runId: number
  ): Promise<JobResult>;
}

export const JOB_HANDLERS: Record<string, JobHandler> = {
  alert: alertJobHandler,
};
