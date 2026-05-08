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
import { runBenchmark } from './runner';

// ── Config (edit here) ────────────────────────────────────────────────────

const CONFIG = {
  model: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  concurrency: 10,
  maxSteps: 40,
  promptId: 'default.system',
  promptVars: {} as Record<string, string>,
  systemPromptAppend: '',
};

// ── Datasets (edit here) ─────────────────────────────────────────────────

const BASE = '/Users/nuwandavek/Documents/minusx/dataagentbench_ucb/mxdatasets';

const DATASETS = [
  { input: `${BASE}/stockindex_input.jsonl`, connections: `${BASE}/stockindex_connections.json` },
  // { input: `${BASE}/revenue_input.jsonl`, connections: `${BASE}/revenue_connections.json` },
  // add more datasets here...
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

console.log(`Model: ${CONFIG.model.provider}/${CONFIG.model.model}`);
console.log(`Datasets: ${DATASETS.length}\n`);

async function main() {
  for (let i = 0; i < DATASETS.length; i++) {
    const ds = DATASETS[i];
    console.log(`\n═══ Dataset ${i + 1}/${DATASETS.length}: ${ds.input} ═══\n`);
    await runBenchmark({
      input: ds.input,
      connections: ds.connections,
      agentClass: Agent,
      registrables,
      concurrency: CONFIG.concurrency,
    });
  }
  console.log(`\n═══ All ${DATASETS.length} datasets complete ═══`);
}

main();
