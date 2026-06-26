import type { TSchema } from 'typebox';
import type { Tool } from '@/orchestrator/llm';
import { registerFauxProvider } from '@/orchestrator/llm/testing';
import { RemoteAnalystAgent } from '@/agents/analyst/analyst-agent';
import { SearchDBSchema, ExecuteQuery, FuzzyMatch } from '@/agents/benchmark-analyst/db-tools.server';
import { SearchFiles } from '@/agents/analyst/file-tools';
import { getAgentModelOrTestFallback, getAnalystModelConfig, getAnalystModelOptions } from '@/agents/analyst/model-config';
import {
  EditFile,
  CreateFile,
  ReadFiles,
  Navigate,
  Screenshot,
  ClarifyFrontend,
  PublishAll,
  LoadSkill,
  LoadContext,
} from './web-tools';

export {
  EditFile,
  CreateFile,
  ReadFiles,
  Navigate,
  Screenshot,
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
    FuzzyMatch.schema,
    ReadFiles.schema,
    SearchFiles.schema,
    EditFile.schema,
    CreateFile.schema,
    Navigate.schema,
    Screenshot.schema,
    ClarifyFrontend.schema,
    PublishAll.schema,
    LoadSkill.schema,
    LoadContext.schema,
  ];
  static model = getAgentModelOrTestFallback(FAUX_MODEL);
  // Call-time stream options (spread blindly into `streamSimple`). Default
  // `reasoning: 'low'` so adaptive thinking is on out of the box;
  // `ANALYST_AGENT_MODEL_CONFIG.options` overrides per-deployment.
  // `webSearch` enables native server-side web search via the pi patch — supported on
  // Anthropic (Messages API) and OpenAI (Responses API). Disabled for other providers
  // (the patch only injects the tool for these two), where it would be a silent no-op.
  static readonly callOptions = {
    reasoning: 'low',
    webSearch: ((p) => p === 'anthropic' || p === 'openai')(getAnalystModelConfig()?.provider ?? 'anthropic'),
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
