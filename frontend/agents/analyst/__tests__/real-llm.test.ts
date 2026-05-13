// Real-LLM AnalystAgent specs. Gated behind RUN_REAL_LLM=1 to keep CI free of
// API calls. Requires ANALYST_AGENT_MODEL_CONFIG (and a provider-specific API key
// like ANTHROPIC_API_KEY) in frontend/.env when enabled.
//
// Run with:
//   cd frontend && RUN_REAL_LLM=1 npm run test:orchestrator -- real-llm
//
// Wire-up uses STUB sources for now — replace with real adapters when available.

import 'dotenv/config';
import { runAgentTestSpec, type TestSpec } from '@/orchestrator/test-spec-runner';
import {
  AnalystAgent,
  ExecuteQuery,
  ListDBConnections,
  SearchDBSchema,
} from '../analyst-agent';
import { setSchemaSource, setSqlExecutor } from '../sources';
import specs from './specs/analyst.real.json';

const RUN_REAL = process.env.RUN_REAL_LLM === '1';
const itIfReal = RUN_REAL ? it : it.skip;

const registrables = [ListDBConnections, SearchDBSchema, ExecuteQuery, AnalystAgent];

beforeAll(() => {
  if (!RUN_REAL) return;

  setSchemaSource({
    async getSchema(_connection: string) {
      return [{
        schema: 'main',
        tables: [
          {
            table: 'users',
            columns: [
              { name: 'id', type: 'int' },
              { name: 'email', type: 'varchar' },
              { name: 'created_at', type: 'timestamp' },
            ],
          },
          {
            table: 'orders',
            columns: [
              { name: 'id', type: 'int' },
              { name: 'user_id', type: 'int' },
              { name: 'total', type: 'decimal' },
              { name: 'placed_at', type: 'timestamp' },
            ],
          },
        ],
      }];
    },
  });

  setSqlExecutor({
    async execute(sql: string, _connection: string) {
      if (/count\s*\(/i.test(sql)) return { rows: [{ count: 42 }] };
      return { rows: [{ note: 'stub executor — wire a real DB to get real rows' }] };
    },
  });

  // Model is read from ANALYST_AGENT_MODEL_CONFIG at module load (see model-config.ts).
});

describe.each(specs as TestSpec[])('real-llm spec: $name', (spec) => {
  itIfReal(
    'passes assertions against a real LLM',
    async () => {
      const { pass, failures, log } = await runAgentTestSpec(spec, registrables);
      const finalAssistant = [...log]
        .reverse()
        .find(
          (e): e is typeof e & { role: 'assistant'; content: { type: string; text?: string }[]; stopReason: string } =>
            'role' in e && e.role === 'assistant' && e.parent_id != null && e.stopReason === 'stop',
        );
      const finalText = finalAssistant
        ? finalAssistant.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
        : '(no final stop message)';
      // eslint-disable-next-line no-console
      console.log(`\n[${spec.name}] User: ${(spec.parameters as { userMessage: string }).userMessage}`);
      // eslint-disable-next-line no-console
      console.log(`[${spec.name}] Final: ${finalText}`);
      expect({ name: spec.name, failures }).toEqual({ name: spec.name, failures: [] });
      expect(pass).toBe(true);
    },
    120_000, // real LLM calls can be slow
  );
});
