#!/usr/bin/env tsx
/**
 * Single-provider streaming check via the real pi-ai path (`getModel` +
 * `streamSimple`), driven by `MODEL_CONFIG` / `ANALYST_AGENT_MODEL_CONFIG` from
 * .env. `getModel` routes through the MX LLM endpoint when `MX_API_BASE_URL` is
 * set, and calls the provider directly when it's empty — run both ways to compare:
 *
 *   DIRECT: MX_API_BASE_URL= node --env-file=.env node_modules/.bin/tsx \
 *             --conditions react-server scripts/bedrock-stream-test.ts
 *   VIA MX: node --env-file=.env node_modules/.bin/tsx \
 *             --conditions react-server scripts/bedrock-stream-test.ts
 *
 * Reports events, streamed-ok, and usage. See scripts/llm-proxy-validate.ts for
 * the multi-provider matrix.
 */
import { getModel, streamSimple } from '@/orchestrator/llm';

// eslint-disable-next-line no-restricted-syntax -- standalone diagnostic script
const MX = process.env.MX_API_BASE_URL;
// MODEL_CONFIG overrides ANALYST_AGENT_MODEL_CONFIG so one harness covers every
// provider, e.g. MODEL_CONFIG='{"provider":"anthropic","model":"claude-sonnet-4-6"}'
// eslint-disable-next-line no-restricted-syntax -- standalone diagnostic script
const RAW = process.env.MODEL_CONFIG || process.env.ANALYST_AGENT_MODEL_CONFIG;

async function main() {
  if (!RAW) throw new Error('ANALYST_AGENT_MODEL_CONFIG is not set');
  const { provider, model, options } = JSON.parse(RAW) as {
    provider: string;
    model: string;
    options?: Record<string, unknown>;
  };

  const mode = MX ? `PROXY → ${MX}/proxy` : 'DIRECT (no proxy)';
  console.log(`\n=== streaming test ===`);
  console.log(`mode     : ${mode}`);
  console.log(`provider : ${provider}`);
  console.log(`model    : ${model}\n`);

  // Instrument fetch so we can see exactly what the proxy returns to pi-ai.
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url;
    const res = await origFetch(input, init);
    console.log(`[fetch] ${init?.method ?? 'GET'} ${url}`);
    console.log(`[fetch]   → status=${res.status} content-type=${res.headers.get('content-type')}`);
    if (!res.ok) {
      const body = await res.clone().text().catch(() => '');
      console.log(`[fetch]   → body: ${body.slice(0, 400)}`);
    }
    return res;
  };

  const handle = getModel(provider, model);
  const context = {
    systemPrompt: 'You are a terse assistant. Answer in plain text.',
    messages: [{ role: 'user' as const, content: 'Count from 1 to 5, one number per line.' }],
  };

  const byType: Record<string, number> = {};
  let textChars = 0;
  let done = false;
  let error: string | null = null;
  let finalText = '';
  let usageStr = 'null';
  const t0 = Date.now();

  try {
    const stream = streamSimple(handle, context as never, { ...(options ?? {}) });
    for await (const ev of stream as AsyncIterable<any>) {
      byType[ev.type] = (byType[ev.type] ?? 0) + 1;
      if (ev.type === 'text_delta') textChars += (ev.delta?.length ?? 0);
      if (ev.type === 'done') {
        done = true;
        finalText = (ev.message?.content ?? [])
          .filter((b: any) => b?.type === 'text')
          .map((b: any) => b.text)
          .join('');
        // pi-ai extracts usage from the provider's own response — proves the client
        // got token/cost data regardless of the proxy. (Proxy-side recording is
        // verified separately by querying its stats DB.)
        usageStr = JSON.stringify(ev.message?.usage ?? null);
      }
      if (ev.type === 'error') error = ev.error?.errorMessage ?? 'error';
    }
  } catch (e: any) {
    error = `THREW: ${e?.message ?? e}`;
  }

  console.log(`events     : ${JSON.stringify(byType)}`);
  console.log(`textChars  : ${textChars}`);
  console.log(`done       : ${done}`);
  console.log(`error      : ${error ?? 'none'}`);
  console.log(`elapsedMs  : ${Date.now() - t0}`);
  console.log(`usage      : ${usageStr}`);
  console.log(`finalText  : ${JSON.stringify(finalText).slice(0, 200)}`);

  const ok = done && !error && textChars > 0;
  console.log(`\nRESULT     : ${ok ? '✅ streamed OK' : '❌ streaming FAILED'}\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('fatal:', e?.message ?? e);
  process.exit(1);
});
