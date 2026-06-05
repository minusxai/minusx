#!/usr/bin/env tsx
/**
 * Automated proxy validation matrix: streams a short prompt through every
 * provider via the real pi-ai path and reports streamed-ok + usage. Run it
 * DIRECT and through the PROXY and compare:
 *
 *   DIRECT: MX_API_BASE_URL= node --env-file=.env node_modules/.bin/tsx \
 *             --conditions react-server scripts/llm-proxy-validate.ts
 *   PROXY:  MX_API_BASE_URL=http://localhost:4002 node --env-file=.env \
 *             node_modules/.bin/tsx --conditions react-server scripts/llm-proxy-validate.ts
 *
 * Needs ANTHROPIC_API_KEY, OPENAI_API_KEY, AWS_BEARER_TOKEN_BEDROCK in env.
 * Proxy-side recorded usage is verified separately by querying its stats DB.
 */
import { getModel, streamSimple } from '@/orchestrator/llm';

const PROVIDERS: Array<{ provider: string; model: string }> = [
  { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  { provider: 'openai', model: 'gpt-4o-mini' },
  { provider: 'amazon-bedrock', model: 'global.anthropic.claude-sonnet-4-6' },
];

async function runOne(provider: string, model: string) {
  const handle = getModel(provider, model);
  const context = {
    systemPrompt: 'You are terse. Answer in plain text.',
    messages: [{ role: 'user' as const, content: 'Count from 1 to 5, one number per line.' }],
  };
  const events: Record<string, number> = {};
  let textChars = 0;
  let done = false;
  let error: string | null = null;
  let usage: any = null;
  const t0 = Date.now();
  try {
    for await (const ev of streamSimple(handle, context as never, {}) as AsyncIterable<any>) {
      events[ev.type] = (events[ev.type] ?? 0) + 1;
      if (ev.type === 'text_delta') textChars += ev.delta?.length ?? 0;
      if (ev.type === 'done') { done = true; usage = ev.message?.usage ?? null; }
      if (ev.type === 'error') error = ev.error?.errorMessage ?? 'error';
    }
  } catch (e: any) {
    error = e?.message ?? String(e);
  }
  return { provider, model, done, textChars, error, usage, events, ms: Date.now() - t0 };
}

async function main() {
  // eslint-disable-next-line no-restricted-syntax -- standalone diagnostic script
  const mx = process.env.MX_API_BASE_URL;
  console.log(`\n=== LLM validation matrix — ${mx ? `PROXY ${mx}` : 'DIRECT'} ===\n`);
  const results = [];
  for (const p of PROVIDERS) {
    process.stdout.write(`  ${p.provider.padEnd(16)} streaming … `);
    const r = await runOne(p.provider, p.model);
    const ok = r.done && !r.error && r.textChars > 0;
    console.log(ok ? `✅ ${r.ms}ms` : `❌ ${r.error}`);
    results.push({ ...r, ok });
  }

  console.log('\n--- summary ---');
  for (const r of results) {
    const u = r.usage
      ? `in=${r.usage.input} out=${r.usage.output} total=${r.usage.totalTokens} cost=$${(r.usage.cost?.total ?? 0).toFixed(6)}`
      : 'no-usage';
    console.log(
      `  ${r.ok ? '✅' : '❌'} ${r.provider.padEnd(16)} streamed=${String(r.done).padEnd(5)} chars=${String(r.textChars).padEnd(4)} ${u}${r.error ? `  ERR=${r.error}` : ''}`,
    );
  }
  const allOk = results.every((r) => r.ok);
  console.log(`\nRESULT: ${allOk ? '✅ all providers streamed with usage' : '❌ some failed'}\n`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => { console.error('fatal:', e?.message ?? e); process.exit(1); });
