// Manual runner for real-LLM AnalystAgent specs.
// Run via: cd frontend && npx tsx scripts/run-real-llm-specs.ts
// Requires ANTHROPIC_API_KEY (or other configured provider) in env.
//
// Wire-up below uses STUB sources for now — replace with a real schema source
// and SQL executor (e.g., DuckDB connection adapter) once those are available.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getModel } from '@mariozechner/pi-ai';
import { runAgentTestSpec, type TestSpec } from '../orchestrator/test-spec-runner';
import {
  AnalystAgent,
  ExecuteSQL,
  SearchDBSchema,
  TalkToUser,
} from '../agents/analyst/analyst-agent';
import { setSchemaSource, setSqlExecutor } from '../agents/analyst/sources';

// ----- Stub sources (replace with real adapters) -----

setSchemaSource({
  async search(query: string) {
    // Pretend `users` and `orders` exist; return a hit if query mentions either.
    const hits = [];
    if (/user/i.test(query)) {
      hits.push({
        table: 'users',
        columns: [
          { name: 'id', type: 'int' },
          { name: 'email', type: 'varchar' },
          { name: 'created_at', type: 'timestamp' },
        ],
        description: 'one row per user account',
      });
    }
    if (/order/i.test(query)) {
      hits.push({
        table: 'orders',
        columns: [
          { name: 'id', type: 'int' },
          { name: 'user_id', type: 'int' },
          { name: 'total', type: 'decimal' },
          { name: 'placed_at', type: 'timestamp' },
        ],
        description: 'one row per order placed',
      });
    }
    return hits;
  },
});

setSqlExecutor({
  async execute(sql: string) {
    // Stub: pretend any "count(*)" returns 42.
    if (/count\s*\(/i.test(sql)) return { rows: [{ count: 42 }] };
    return { rows: [{ note: 'stub executor — wire a real DB to get real rows' }] };
  },
});

// ----- Real model — replace 'claude-sonnet-4-5' with whatever pi-ai exposes for your provider/model -----

AnalystAgent.model = getModel('anthropic', 'claude-sonnet-4-5');

// ----- Run -----

const specsPath = path.join(
  __dirname,
  '..',
  'agents',
  'analyst',
  '__tests__',
  'specs',
  'analyst.real.json',
);
const specs = JSON.parse(fs.readFileSync(specsPath, 'utf-8')) as TestSpec[];

const registrables = [SearchDBSchema, ExecuteSQL, TalkToUser, AnalystAgent];

(async () => {
  for (const spec of specs) {
    process.stdout.write(`\n=== ${spec.name} ===\n`);
    process.stdout.write(`User: ${(spec.parameters as { userMessage: string }).userMessage}\n`);
    try {
      const { pass, failures, log } = await runAgentTestSpec(spec, registrables);
      const finalAssistant = [...log]
        .reverse()
        .find(
          (e): e is typeof e & { role: 'assistant'; content: { type: string; text?: string }[]; stopReason: string } =>
            'role' in e && e.role === 'assistant' && e.parent_id != null && e.stopReason === 'stop',
        );
      const finalText = finalAssistant
        ? finalAssistant.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('\n')
        : '(no final stop message)';
      process.stdout.write(`Final: ${finalText}\n`);
      process.stdout.write(`${pass ? 'PASS' : 'FAIL'}${failures.length ? ` — ${failures.join('; ')}` : ''}\n`);
    } catch (err) {
      process.stdout.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
})();
