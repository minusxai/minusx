// Shared base for V2 data tools (SearchDBSchema / ExecuteQuery / Explore).
//
// Owns the lighter-model "+prompt" pass implementation. Each tool's call
// site is just `await this.runPromptPass(entries, prompt, model, maxChars?)`
// — context (`contextDocs` / `originalMessage`), orchestrator, and tool id
// are read off `this` rather than plumbed through args. The pure pieces of
// the pass (user-content building, JSON parsing, rerank application) live in
// prompt-pass.ts so they can be tested in isolation.

import 'server-only';
import type { TSchema } from '@mariozechner/pi-ai';
import { MXTool } from '@/orchestrator/types';
import type { BenchmarkAnalystContext } from '../types';
import type { Api, Model } from '@/lib/llm/get-model';
import { TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';
import {
  buildPromptPassContext,
  parsePromptPassResponse,
  buildPromptPassPreviews,
  pickPromptPassInfo,
  extractText,
  type PromptPassEntry,
  type PromptPassResult,
} from './prompt-pass';

export abstract class V2DataTool<P extends TSchema, D = unknown>
  extends MXTool<P, BenchmarkAnalystContext, D>
{
  /**
   * Lighter-model "+prompt" pass. Reads `this.context` for grounding
   * (`contextDocs`, `originalMessage`), `this.orchestrator` for the LLM
   * call, and `this.id` for log parenthood — no per-call plumbing.
   */
  protected async runPromptPass(
    entries: PromptPassEntry[],
    prompt: string,
    model: Model<Api>,
    maxChars: number = TOOL_MAX_LIMIT_CHARS,
  ): Promise<PromptPassResult> {
    const llmCtx = buildPromptPassContext(entries, prompt, this.context);
    const text = extractText(
      await this.orchestrator.callLLM(model, llmCtx, this.id, { maxTokens: 4096 }),
    );
    const parsed = parsePromptPassResponse(text);
    return {
      previews: buildPromptPassPreviews(entries, parsed, maxChars),
      info: pickPromptPassInfo(parsed, text),
    };
  }
}
