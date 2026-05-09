// Data analyst benchmark — edit config and datasets below, then run:
//   cd frontend && npm run benchmark:analyst

// import { writeFileSync } from 'node:fs';
// import path from 'node:path';
// import { fileURLToPath } from 'node:url';
import { type Tool, type TSchema } from '@mariozechner/pi-ai';
import { getModel } from '@/lib/llm/get-model';
import { DAB_BENCH_BASE_DIR } from '@/lib/config';
import { renderPrompt } from '@/orchestrator/prompts';
import {
  BenchmarkAnalystAgent,
  SearchDBSchema,
  ExecuteSQL,
} from '@/agents/benchmark-analyst/benchmark-analyst';
import { runBenchmark, logHeader, logSummary } from './runner';

const tools = [
    SearchDBSchema.schema,
    ExecuteSQL.schema,
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

const DATASETS = [
  // { input: `${BASE}/test_input.jsonl`, connections: `${BASE}/test_connections.json` },
  { input: `${BASE}/stockindex_input.jsonl`, connections: `${BASE}/stockindex_connections.json` },
];

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

const registrables = [SearchDBSchema, ExecuteSQL, Agent];


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
