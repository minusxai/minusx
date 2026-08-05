import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';

/**
 * QA config (Tests/QA/Evals Arch V2 — Phase 5). Drives a deployment, asserting
 * via Redux (through the runtime opt-in `?e2e=<secret>`) + DOM. Real LLM — the
 * faux channel is 404 on a prod build — so QA flows use deterministic outcome
 * assertions (no assertLLMReceived) and stay LLM-cost-free unless a spec opts in.
 *
 *   Prod:  QA_BASE_URL=… QA_EMAIL=… QA_PASSWORD=… QA_E2E_SECRET=… npm run test:qa
 *   Local: npm run test:qa  → boots a prod-ish server (E2E_MODE OFF, runtime
 *          secret ON) to verify the gate end-to-end before deploying.
 *
 * Credentials come from env / .env only — never committed.
 */
loadEnv(); // load frontend/.env so local QA_* vars are picked up (does not override real env)

const EXTERNAL = process.env.QA_BASE_URL;
const PORT = Number(process.env.QA_PORT ?? 3101);
const LOCAL_URL = `http://localhost:${PORT}`;
const BASE_URL = EXTERNAL || LOCAL_URL;
const AUTH_FILE = path.join(process.cwd(), 'test/qa/.auth/qa.json');
const PGLITE_DIR = path.join(process.cwd(), 'data/pglite-qa');
if (!EXTERNAL) fs.mkdirSync(PGLITE_DIR, { recursive: true });

// Worker count. Defaults to 2 (CI leaves QA_PARALLELISM unset → stays at 2);
// set QA_PARALLELISM locally (e.g. in frontend/.env) to fan out wider. Falls
// back to 2 for unset/0/non-numeric values.
const QA_WORKERS = Number(process.env.QA_PARALLELISM) || 2;

export default defineConfig({
  testDir: './test/qa',
  // Playwright's DEFAULT testMatch is `**/*.@(spec|test).*`, so it also claims
  // Vitest files. A `__tests__/*.test.ts` next to the flows (unit cover for the
  // helpers they share) made Playwright import `vitest` while COLLECTING, which
  // fails the entire run — every shard, before a single test executes. Vitest
  // owns `__tests__`; this suite owns `*.spec.ts`.
  testIgnore: '**/__tests__/**',
  // QA flows are read-only and run entirely in tutorial mode (reset once up front
  // via the setup chain), so they parallelize safely. Defaults to 2; override
  // locally with QA_PARALLELISM (see QA_WORKERS above).
  fullyParallel: true,
  workers: QA_WORKERS,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  // Every run starts with a clean metrics dir (see test/qa/metrics.ts) so the
  // per-run report reflects exactly this run.
  globalSetup: './test/qa/metrics.global-setup.ts',
  // Ordered setup chain: (provision →) log in → reset tutorial → run flows.
  // Provision is an env-gated no-op unless QA_PROVISION_WORKSPACE is set (it
  // registers a fresh workspace through the real registration form first).
  // The reset uses the admin storageState and is best-effort (skips on a
  // non-admin account).
  projects: [
    { name: 'provision', testMatch: /provision\.setup\.ts/ },
    { name: 'setup', testMatch: /auth\.setup\.ts/, dependencies: ['provision'] },
    {
      name: 'reset',
      testMatch: /reset\.setup\.ts/,
      use: { storageState: AUTH_FILE },
      dependencies: ['setup'],
    },
    {
      name: 'qa',
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
      dependencies: ['reset'],
    },
  ],
  // Local-only: a prod-ish server (build-time E2E flag OFF, runtime secret ON),
  // so the gate — not the build flag — does the work. Skipped when QA_BASE_URL is set.
  webServer: EXTERNAL
    ? undefined
    : {
        // A real PROD build + start (not `next dev`): precompiled routes are stable
        // under parallel workers — the dev server compiles on-demand and races cold
        // builds → page.goto timeouts. Also genuinely "prod-ish" (the config's intent).
        //
        // QA_SKIP_BUILD: in CI the build is produced ONCE by a dedicated job and the
        // .next-qa output is restored here as an artifact, so the sharded flow jobs
        // only `next start` (no rebuild). Locally the default builds then starts.
        command: process.env.QA_SKIP_BUILD ? 'npm run start' : 'npm run build && npm run start',
        url: LOCAL_URL,
        timeout: 600_000, // a cold prod build can take several minutes
        reuseExistingServer: !process.env.CI,
        env: {
          ...process.env,
          PORT: String(PORT),
          AUTH_URL: LOCAL_URL,
          NEXTAUTH_URL: LOCAL_URL,
          // deliberately NO NEXT_PUBLIC_E2E → E2E_MODE off (the runtime gate does the work).
          NEXT_DIST_DIR: '.next-qa',
          DB_TYPE: 'pglite',
          PGLITE_DATA_DIR: PGLITE_DIR,
          NODE_OPTIONS: '--max-old-space-size=4096',
          E2E_RUNTIME_SECRET: process.env.QA_E2E_SECRET || 'local-qa-secret',
        },
      },
});
