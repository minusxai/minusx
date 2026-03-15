import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { JobHandlerResult, JobRunnerInput } from '@/lib/types';
import { alertJobHandler } from './handlers/alert-handler';

export interface JobHandler {
  execute(input: JobRunnerInput, user: EffectiveUser): Promise<JobHandlerResult>;
}

export const JOB_HANDLERS: Record<string, JobHandler> = {
  alert: alertJobHandler,
};
