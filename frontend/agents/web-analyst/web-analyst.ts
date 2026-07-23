import type { TSchema } from 'typebox';
import type { Tool } from '@/orchestrator/llm';
import { registerFauxProvider } from '@/orchestrator/llm/testing';
import { RemoteAnalystAgent } from '@/agents/analyst/analyst-agent';
import { SearchDBSchema, ExecuteQuery, RunSemanticQuery, FuzzyMatch } from '@/agents/benchmark-analyst/db-tools.server';
import { SearchFiles } from '@/agents/analyst/file-tools';
import { CheckFileHealth } from '@/agents/analyst/health-tools';
import { getAgentModelOrTestFallback, getAnalystModelOptions } from '@/agents/analyst/model-config';
import {
  EditFile,
  CreateFile,
  DetachViz,
  ReadFiles,
  Navigate,
  ReviewFile,
  ClarifyFrontend,
  PublishAll,
  LoadSkill,
  LoadContext,
} from './web-tools';

export {
  EditFile,
  CreateFile,
  DetachViz,
  ReadFiles,
  Navigate,
  ReviewFile,
  Screenshot, // legacy alias of ReviewFile — registered for old logs, not in the toolset
  ClarifyFrontend,
  PublishAll,
  LoadSkill,
  LoadContext,
} from './web-tools';

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
    SearchDBSchema.schema,
    ExecuteQuery.schema,
    RunSemanticQuery.schema,
    FuzzyMatch.schema,
    ReadFiles.schema,
    SearchFiles.schema,
    CheckFileHealth.schema,
    EditFile.schema,
    CreateFile.schema,
    DetachViz.schema,
    Navigate.schema,
    ReviewFile.schema,
    ClarifyFrontend.schema,
    PublishAll.schema,
    LoadSkill.schema,
    LoadContext.schema,
  ];
  static model = getAgentModelOrTestFallback(FAUX_MODEL);
  static override readonly llmAgent = 'web-analyst';
  // Call-time stream options (spread blindly into `streamSimple`). Default
  // `reasoning: 'low'` so adaptive thinking is on out of the box; the DB model
  // plan's options merge over these per call (Settings → Models assignments).
  // `webSearch` enables native server-side web search via the pi patch —
  // supported on Anthropic (Messages API), OpenAI (Responses API), and the
  // MinusX gateway (default provider); a silent no-op elsewhere. Disable per
  // workspace via the assignment's options when routing to another provider.
  static readonly callOptions = {
    reasoning: 'low',
    webSearch: true,
    ...(getAnalystModelOptions() ?? {}),
  };

  protected getSystemPrompt(): string {
    // Re-uses the RemoteAnalystAgent prompt (production prompts.yaml) under
    // a different agent_name so the LLM knows it's the web variant. The set
    // of advertised tools (in `static tools`) does the heavy lifting.
    const base = super.getSystemPrompt();
    return base.replace(/\bAnalystAgent\b/, 'WebAnalystAgent');
  }

  /**
   * Add the user's city as web-search `userLocation`. Falls back to the static callOptions
   * (webSearch: true, no location) when no city is known.
   */
  protected resolveCallOptions(): Record<string, unknown> | undefined {
    const base = super.resolveCallOptions() ?? {};
    const city = this.context.city;
    if (!city) return base;
    return { ...base, webSearch: { userLocation: { city } } };
  }
}
