import {
  Type,
  registerFauxProvider,
  type Tool,
  type TSchema,
} from '@mariozechner/pi-ai';
import { MXAgent } from '@/orchestrator/types';
import { renderPrompt } from '@/orchestrator/prompts';
import { getAnalystModel } from '@/agents/analyst/model-config';
import { ListDBConnections, SearchDBSchema, ExecuteQuery } from './db-tools';
import type { BenchmarkAnalystContext } from './types';

export const fauxRegistration = registerFauxProvider({
  api: 'faux-benchmark-analyst-api',
  provider: 'faux-benchmark-analyst',
  models: [{ id: 'stub-benchmark-analyst' }],
});
const FAUX_MODEL = fauxRegistration.getModel();

const BenchmarkAnalystAgentParams = Type.Object({
  userMessage: Type.String(),
});

/**
 * Bare-bones connection-aware analyst. Has DB tools only — no file system
 * access, no AppState wrapping. Subclasses (e.g. RemoteAnalystAgent) extend
 * with file tools, app context, and a richer user-content shape.
 */
export class BenchmarkAnalystAgent<
  TContext extends BenchmarkAnalystContext = BenchmarkAnalystContext,
> extends MXAgent<typeof BenchmarkAnalystAgentParams, TContext> {
  static readonly schema: Tool<typeof BenchmarkAnalystAgentParams> = {
    name: 'BenchmarkAnalystAgent',
    description: 'Connection-aware analyst that answers data questions via DB tools.',
    parameters: BenchmarkAnalystAgentParams,
  };
  static readonly tools: Tool<TSchema>[] = [
    ListDBConnections.schema,
    SearchDBSchema.schema,
    ExecuteQuery.schema,
  ];
  static model = getAnalystModel() ?? FAUX_MODEL;

  protected getSystemPrompt(): string {
    return renderPrompt('default.system', {
      agent_name: 'BenchmarkAnalystAgent',
      max_steps: '40',
      allowed_viz_types: '',
      role: '',
      schema: '',
      context: '',
      skills_catalog: '',
      connection_id: '',
      home_folder: '',
      preloaded_skills: '',
    });
  }
}

export { ListDBConnections, SearchDBSchema, ExecuteQuery };
