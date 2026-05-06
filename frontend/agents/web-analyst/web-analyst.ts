import {
  registerFauxProvider,
  type Tool,
  type TSchema,
} from '@mariozechner/pi-ai';
import { RemoteAnalystAgent } from '@/agents/analyst/analyst-agent';
import { ListDBConnections, SearchDBSchema, ExecuteSQL } from '@/agents/benchmark-analyst/db-tools';
import { ReadFiles, SearchFiles } from '@/agents/analyst/file-tools';
import { getAnalystModel } from '@/agents/analyst/model-config';
import { EditFile, CreateFile, DeleteFile } from './web-tools';

export { EditFile, CreateFile, DeleteFile } from './web-tools';

export const fauxRegistration = registerFauxProvider({
  api: 'faux-web-analyst-api',
  provider: 'faux-web-analyst',
  models: [{ id: 'stub-web-analyst' }],
});
const FAUX_MODEL = fauxRegistration.getModel();

/**
 * Browser-side analyst. Inherits the full RemoteAnalystAgent toolset (DB
 * tools + ReadFiles/SearchFiles) and adds three frontend-only tools that
 * pause the orchestrator via UserInputException. The Redux listener
 * middleware calls `executeToolCall()` for them and resumes.
 */
export class WebAnalystAgent extends RemoteAnalystAgent {
  static readonly schema: Tool<typeof RemoteAnalystAgent.schema.parameters> = {
    name: 'WebAnalystAgent',
    description: 'Browser-side analyst that can read/search files, run SQL, and edit/create/delete files via the frontend bridge.',
    parameters: RemoteAnalystAgent.schema.parameters,
  };
  static readonly tools: Tool<TSchema>[] = [
    ListDBConnections.schema,
    SearchDBSchema.schema,
    ExecuteSQL.schema,
    ReadFiles.schema,
    SearchFiles.schema,
    EditFile.schema,
    CreateFile.schema,
    DeleteFile.schema,
  ];
  static model = getAnalystModel() ?? FAUX_MODEL;

  protected getSystemPrompt(): string {
    // Re-uses the RemoteAnalystAgent prompt (production prompts.yaml) under
    // a different agent_name so the LLM knows it's the web variant. The set
    // of advertised tools (in `static tools`) does the heavy lifting.
    const base = super.getSystemPrompt();
    return base.replace(/\bAnalystAgent\b/, 'WebAnalystAgent');
  }
}
