// Data analyst benchmark — edit config and datasets below, then run:
//   cd frontend && npm run benchmark:analyst

import { getModel, type Tool, type TSchema } from '@mariozechner/pi-ai';
import { renderPrompt } from '@/orchestrator/prompts';
import {
  BenchmarkAnalystAgent,
  ListDBConnections,
  SearchDBSchema,
  ExecuteSQL,
} from '@/agents/benchmark-analyst/benchmark-analyst';
import { runBenchmark, logHeader, logSummary } from './runner';

// ── Config (edit here) ────────────────────────────────────────────────────

const CONFIG = {
  model: { provider: 'anthropic', model: 'claude-haiku-4-5' },
  concurrency: 10,
  maxSteps: 40,
  promptId: 'default.system',
  promptVars: {} as Record<string, string>,
  systemPromptAppend: '',
};

// ── Datasets (edit here) ─────────────────────────────────────────────────

const BASE = '/Users/nuwandavek/Documents/minusx/dataagentbench_ucb/mxdatasets';

const DATASETS = [
//   { input: `${BASE}/test_input.jsonl`, connections: `${BASE}/test_connections.json` },
  { input: `${BASE}/stockindex_input.jsonl`, connections: `${BASE}/stockindex_connections.json` },
];

// ── Agent (customize tools / prompt here) ─────────────────────────────────

class Agent extends BenchmarkAnalystAgent {
  static readonly tools: Tool<TSchema>[] = [
    ListDBConnections.schema,
    SearchDBSchema.schema,
    ExecuteSQL.schema,
  ];
  static model = getModel(
    CONFIG.model.provider as never,
    CONFIG.model.model as never,
  );

  protected getSystemPrompt(): string {
    const vars: Record<string, string> = {
      agent_name: 'BenchmarkAnalystAgent',
      max_steps: String(CONFIG.maxSteps),
      allowed_viz_types: '',
      role: '',
      schema: '',
      context: '',
      skills_catalog: '',
      connection_id: '',
      home_folder: '',
      preloaded_skills: '',
      ...CONFIG.promptVars,
    };
    const rendered = renderPrompt(CONFIG.promptId, vars);
    return CONFIG.systemPromptAppend
      ? `${rendered}\n\n${CONFIG.systemPromptAppend}`
      : rendered;
  }
}

// ── Run ───────────────────────────────────────────────────────────────────

const registrables = [ListDBConnections, SearchDBSchema, ExecuteSQL, Agent];

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
