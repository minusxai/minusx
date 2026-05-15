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
import { getOrCreateBenchmarkConnector } from '../shared-duckdb';
import type { NodeConnector } from '@/lib/connections/base';
import { getModel, type Api, type Model } from '@/lib/llm/get-model';
import { TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';
import {
  runPromptPassFree,
  type PromptPassEntry,
  type PromptPassResult,
} from './prompt-pass';

// Shared lighter model for the "+prompt" passes across V2 data tools.
// Defaults to Haiku; tests override via `setLighterModel`.
const DEFAULT_LIGHTER_MODEL = getModel('anthropic', 'claude-haiku-4-5-20251001');
let lighterModel: Model<Api> = DEFAULT_LIGHTER_MODEL;
export function setLighterModel(m: Model<Api>): void { lighterModel = m; }
export function getLighterModel(): Model<Api> { return lighterModel; }

export abstract class V2DataTool<P extends TSchema, D = unknown>
  extends MXTool<P, BenchmarkAnalystContext, D>
{
  /**
   * Per-connection-name connectors, populated lazily by `ensureConnectors`.
   * Tools that query data (ExecuteQuery, Explore) call `ensureConnectors`
   * in `run()` before use; SearchDBSchema queries the catalog and leaves
   * these untouched.
   */
  protected connectors = new Map<string, NodeConnector>();
  protected dialects = new Map<string, string>();

  /** Lazily build a NodeConnector per `this.context.connections[*]`. Idempotent. */
  protected async ensureConnectors(): Promise<void> {
    for (const entry of this.context.connections ?? []) {
      if (!entry.config) continue;
      if (this.connectors.has(entry.name)) continue;
      const c = await getOrCreateBenchmarkConnector(entry.name, entry.dialect, entry.config);
      this.connectors.set(entry.name, c);
      this.dialects.set(entry.name, entry.dialect);
    }
  }

  /**
   * Lighter-model "+prompt" pass. Reads `this.context` for grounding
   * (`contextDocs`, `originalMessage`), `this.orchestrator` for the LLM
   * call, and `this.id` for log parenthood — no per-call plumbing. Thin
   * wrapper over the orchestrator-free `runPromptPassFree`; the catalog
   * builder uses the same helper with its own stateless `callLLM`.
   */
  protected async runPromptPass(
    entries: PromptPassEntry[],
    prompt: string,
    model: Model<Api>,
    maxChars: number = TOOL_MAX_LIMIT_CHARS,
  ): Promise<PromptPassResult> {
    return runPromptPassFree(
      entries,
      prompt,
      model,
      this.context,
      (m, ctx) => this.orchestrator.callLLM(m, ctx, this.id, { maxTokens: 4096 }),
      maxChars,
    );
  }
}
