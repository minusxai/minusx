import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { JobHandlerResult, JobRunnerInput } from '@/lib/types';
import { alertJobHandler } from './handlers/alert-handler';
import { transformationJobHandler } from './handlers/transformation-handler';
import { contextJobHandler } from './handlers/context-handler';
import { reportJobHandler } from './handlers/report-handler';

export interface JobHandler {
  execute(input: JobRunnerInput, user: EffectiveUser): Promise<JobHandlerResult>;
}

export const JOB_HANDLERS: Record<string, JobHandler> = {
  alert: alertJobHandler,
  transformation: transformationJobHandler,
  context: contextJobHandler,
  report: reportJobHandler,
};
