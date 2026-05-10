// Data analyst benchmark — edit config and datasets below, then run:
//   cd frontend && npm run benchmark:dab
//
// Datasets are auto-discovered: every `<name>_input.jsonl` in
// DAB_BENCH_BASE_DIR is paired with `<name>_connections.json`. To run a
// subset, set DAB_BENCH_DATASETS to a comma-separated list of names,
// e.g. `DAB_BENCH_DATASETS=agnews,yelp npm run benchmark:dab`.

import { readdirSync, existsSync } from 'node:fs';
import { type Tool, type TSchema } from '@mariozechner/pi-ai';
import { getModel } from '@/lib/llm/get-model';
import { DAB_BENCH_BASE_DIR, DAB_BENCH_DATASETS } from '@/lib/config';
import { renderPrompt } from '@/orchestrator/prompts';
import {
  BenchmarkAnalystAgent,
  SearchDBSchema,
  ExecuteQuery,
} from '@/agents/benchmark-analyst/benchmark-analyst';
import { runBenchmark, logHeader, logSummary } from './runner';

const tools = [
    SearchDBSchema.schema,
    ExecuteQuery.schema,
  ];

// ── Config ────────────────────────────────────────────────────

const CONFIG = {
  model: { provider: 'anthropic', model: 'claude-haiku-4-5' },
  concurrency: 10,
  promptId: 'default.system',
  promptVars: {
    agent_name: 'MinusX Benchmark Agent',
    max_steps: '40',
    allowed_viz_types: 'table',
    role: 'admin',
    schema: '',
    context: '',
    skills_catalog: '',
    home_folder: '',
    preloaded_skills: '',
  } as Record<string, string>,
  systemPromptAppend: `## Benchmark Specific Instructions and Customization
  - You are solving a benchmark task. Your goal is to analyze the questions, and give very specific answers.
  - Only tools you have access to: ${tools.map((t) => `\`${t.name}\``).join(', ')}. Don't hallucinate any other tools.
  - You DO NOT have any other existing files with questions.
  - The answer needs to be in under 200 words. This is a benchmark, a user is not reading the answer and the evaluation might be error-prone on long winded answers. Be concise and specific. Don't add any unnecessary information. Just answer the question as directly as possible.
  `
};

// ── Datasets─────────────────────────────────────────────────

const BASE = DAB_BENCH_BASE_DIR;
if (!BASE) {
  throw new Error('DAB_BENCH_BASE_DIR env variable is required (path to mxdatasets directory)');
}

// Auto-discover datasets: every `<name>_input.jsonl` in BASE is paired
// with `<name>_connections.json`. Skips inputs without a matching
// connections file. Optional DAB_BENCH_DATASETS env (comma-separated
// names) filters to a subset; useful when iterating on a single dataset.
function discoverDatasets(baseDir: string): { input: string; connections: string }[] {
  const inputSuffix = '_input.jsonl';
  const allInputs = readdirSync(baseDir).filter((f) => f.endsWith(inputSuffix));
  const filter = DAB_BENCH_DATASETS
    ? new Set(DAB_BENCH_DATASETS.split(',').map((s) => s.trim()).filter(Boolean))
    : null;
  const datasets: { input: string; connections: string }[] = [];
  for (const fileName of allInputs.sort()) {
    const name = fileName.slice(0, -inputSuffix.length);
    if (filter && !filter.has(name)) continue;
    const connectionsPath = `${baseDir}/${name}_connections.json`;
    if (!existsSync(connectionsPath)) {
      console.warn(`Skipping ${name}: no matching connections file at ${connectionsPath}`);
      continue;
    }
    datasets.push({ input: `${baseDir}/${fileName}`, connections: connectionsPath });
  }
  if (filter) {
    const matched = new Set(datasets.map((d) => d.input.slice(d.input.lastIndexOf('/') + 1, -inputSuffix.length)));
    for (const requested of filter) {
      if (!matched.has(requested)) {
        console.warn(`DAB_BENCH_DATASETS: dataset '${requested}' not found in ${baseDir}`);
      }
    }
  }
  return datasets;
}

const DATASETS = discoverDatasets(BASE);

// ── Agent (customize tools / prompt here) ─────────────────────────────────

class Agent extends BenchmarkAnalystAgent {
  static readonly tools: Tool<TSchema>[] = tools;
  static model = getModel(
    CONFIG.model.provider as never,
    CONFIG.model.model as never,
  );

  protected getSystemPrompt(): string {
    const vars: Record<string, string> = {
      connection_id: `Available connections: \n${JSON.stringify(this.context.connections ?? [])}`,
      ...CONFIG.promptVars,
    };
    const rendered = renderPrompt(CONFIG.promptId, vars);
    const prompt = CONFIG.systemPromptAppend
      ? `${rendered}\n\n${CONFIG.systemPromptAppend}`
      : rendered;
    // Dump to file for live inspection
    // const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'rendered_system_prompt.md');
    // writeFileSync(outPath, prompt);
    return prompt;
  }
}

// ── Run ───────────────────────────────────────────────────────────────────

const registrables = [SearchDBSchema, ExecuteQuery, Agent];


logHeader(`Data Analyst Bench  ${CONFIG.model.provider}/${CONFIG.model.model}  ${DATASETS.length} datasets`);

async function main() {
  const globalStart = Date.now();
  let totalRows = 0;
  let totalErrors = 0;

  for (const ds of DATASETS) {
    const result = await runBenchmark({
      input: ds.input,
      connections: ds.connections,
      agentClass: Agent,
      registrables,
      concurrency: CONFIG.concurrency,
    });
    totalRows += result.rows;
    totalErrors += result.errors;
  }

  logSummary(DATASETS.length, totalRows, totalErrors, Date.now() - globalStart);
}

main();
