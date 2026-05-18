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
import type { SampleConfig } from './catalog';

/** Per-slot sample prompts. Different prompts make the two DoubleCheck
 *  sub-agents see different sample rows + shape notes — reduces the
 *  chance both fall into the same data-shape misreading. */
const SAMPLE_PROMPTS = {
  representative: 'Pick 10 rows that best demonstrate the typical shape and value patterns of this table. In info, write 1–3 short sentences describing notable data shape, storage quirks (e.g. stringified dicts, embedded delimiters, weird date formats), and value distributions a downstream query writer should know.',
  'edge-cases': 'Pick 10 rows that emphasize edge cases and rare value variants — focus on rows that look unusual, NULL-heavy, or that span the value space at its extremes. In info, write 1–3 short sentences describing notable data shape, storage quirks, and edge-case patterns a downstream query writer should know.',
} as const;

// Shared lighter model for the "+prompt" passes across V2 data tools.
// Default kept on Haiku because test envs (and any deploy without an
// OPENAI_API_KEY) would fail at first call. Flip via `setLighterModel`
// at startup (or in a wrapper) when running with OpenAI credentials.
const DEFAULT_LIGHTER_MODEL = getModel('anthropic', 'claude-haiku-4-5-20251001');
let lighterModel: Model<Api> = DEFAULT_LIGHTER_MODEL;
export function setLighterModel(m: Model<Api>): void { lighterModel = m; }
export function getLighterModel(): Model<Api> { return lighterModel; }

// Master toggle for the catalog-build sample pass (per-table lighter-model
// pick + shape note). Default ON for production / the V2 benchmark path.
// Tests that target other code paths (Explore search, SearchDBSchema query
// dispatch, etc.) flip this OFF in `beforeAll` so the sample-build LLM
// calls don't drain their faux-provider response queue. Tests that
// specifically cover sample-building flip it back on locally.
let samplingEnabled = true;
export function setSamplingEnabled(v: boolean): void { samplingEnabled = v; }
export function getSamplingEnabled(): boolean { return samplingEnabled; }

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
    const datasetKey = this.context.datasetKey;
    for (const entry of this.context.connections ?? []) {
      if (!entry.config) continue;
      if (this.connectors.has(entry.name)) continue;
      const c = await getOrCreateBenchmarkConnector(
        entry.name, entry.dialect, entry.config, { datasetKey },
      );
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

  /**
   * Build the `SampleConfig` to hand to `getCatalogStore`. Picks the slot
   * prompt off `this.context.catalogKey` — `'agent-b'` gets the edge-case
   * prompt, everything else gets the representative one. Returns
   * `undefined` only when there are no connections to sample (catalog is
   * empty anyway).
   */
  protected buildSampleConfig(): SampleConfig | undefined {
    if (!samplingEnabled) return undefined;
    if (!this.context.connections || this.context.connections.length === 0) {
      return undefined;
    }
    const slotPrompt =
      this.context.catalogKey === 'agent-b'
        ? SAMPLE_PROMPTS['edge-cases']
        : SAMPLE_PROMPTS.representative;
    return {
      slotPrompt,
      model: getLighterModel(),
      callLLM: (m, ctx) =>
        this.orchestrator.callLLM(m, ctx, this.id, { maxTokens: 4096 }),
    };
  }

  /** Resolve the catalog cache key from context (defaults to `'default'`). */
  protected catalogKey(): string {
    return this.context.catalogKey ?? 'default';
  }
}
