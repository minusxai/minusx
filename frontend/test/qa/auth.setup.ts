/**
 * QA auth (Tests/QA/Evals Arch V2 — Phase 5). Logs in with env credentials and
 * saves storageState. Does NOT set the `?e2e` cookie — specs opt into the store
 * exposure themselves, so the runtime-gate negative test stays valid.
 *
 * Local (no QA_BASE_URL): seeds the workspace + marks onboarding complete.
 * Prod (QA_BASE_URL set): the account already exists — just log in.
 */
import { test as setup } from '@playwright/test';
import path from 'node:path';

const AUTH_FILE = path.join(process.cwd(), 'test/qa/.auth/qa.json');
// A localhost target (a local prod build under test) still needs seeding + onboarding,
// like the webServer case; only a real remote deployment is treated as pre-provisioned —
// unless provision.setup just created it (QA_PROVISION_WORKSPACE), in which case the
// fresh workspace needs the same onboarding + LLM seeding a fresh local one does.
const EXTERNAL = !!process.env.QA_BASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.QA_BASE_URL);
const PROVISIONED = !!process.env.QA_PROVISION_WORKSPACE;
const EMAIL = process.env.QA_EMAIL || 'qa-admin@test.local';
const PASSWORD = process.env.QA_PASSWORD || EMAIL;

setup('authenticate qa user', async ({ page, request }) => {
  if (!EXTERNAL) {
    // Local prod-ish server starts empty — seed the admin (idempotent).
    const reg = await request.post('/api/orgs/register', {
      data: { workspaceName: 'qa-workspace', adminName: 'QA Admin', adminEmail: EMAIL, adminPassword: PASSWORD },
    });
    if (![200, 201, 409].includes(reg.status())) {
      throw new Error(`qa register failed: ${reg.status()} ${await reg.text()}`);
    }
  }

  await page.goto('/login');
  await page.getByPlaceholder('Email', { exact: true }).fill(EMAIL);
  const pw = page.getByPlaceholder('Password', { exact: true });
  await pw.fill(PASSWORD);
  await pw.press('Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });

  // A fresh workspace needs onboarding marked complete + an LLM config —
  // whether it's a local prod build (seeded above) or a workspace that
  // provision.setup just registered on a remote target.
  if (!EXTERNAL || PROVISIONED) {
    await page.request.post('/api/configs', { data: { setupWizard: { status: 'complete' } } });

    // Model config is DB-only (no env tier in the app). Seed the in-app LLM
    // config through the same /api/configs path a real admin uses, so
    // real-LLM flows can run against the fresh workspace. The runner-side
    // ANALYST_AGENT_MODEL_CONFIG JSON ({provider, model, options?, apiKey?,
    // awsRegion?} — the CI secret) picks the exact model. A self-contained
    // config carries its own apiKey and works for ANY provider; without one,
    // the ANTHROPIC_API_KEY / AWS_BEARER_TOKEN_BEDROCK runner credentials
    // cover the two default providers as before.
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const bedrockKey = process.env.AWS_BEARER_TOKEN_BEDROCK;
    let hint: { provider?: string; model?: string; options?: Record<string, unknown>; apiKey?: string; awsRegion?: string } = {};
    try {
      hint = JSON.parse(process.env.ANALYST_AGENT_MODEL_CONFIG || '{}');
    } catch { /* malformed hint — fall through to defaults */ }
    if (anthropicKey || bedrockKey || hint.apiKey) {
      const slug = hint.provider ?? (anthropicKey ? 'anthropic' : 'amazon-bedrock');
      const apiKey = hint.apiKey ?? (slug === 'amazon-bedrock' ? bedrockKey : anthropicKey);
      if (!apiKey) {
        throw new Error(`qa llm config: no API key for provider '${slug}' (set apiKey in ANALYST_AGENT_MODEL_CONFIG or the matching runner credential)`);
      }
      const provider = {
        name: `qa-${slug}`,
        provider: slug,
        apiKey,
        ...(slug === 'amazon-bedrock' ? { awsRegion: hint.awsRegion ?? process.env.AWS_REGION ?? 'us-east-1' } : {}),
      };
      const model = hint.model ?? (slug === 'amazon-bedrock' ? 'anthropic.claude-sonnet-4-6' : 'claude-sonnet-4-6');
      const choice = { providerName: provider.name, model, options: hint.options ?? { reasoning: 'low' } };
      const llmRes = await page.request.post('/api/configs', {
        data: { llm: { providers: [provider], grades: { lite: choice, core: choice, advanced: choice } } },
      });
      if (!llmRes.ok()) {
        throw new Error(`qa llm config seed failed: ${llmRes.status()} ${await llmRes.text()}`);
      }
    }
  }

  await page.context().storageState({ path: AUTH_FILE });
});
