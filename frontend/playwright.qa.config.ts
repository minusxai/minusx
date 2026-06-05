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

export default defineConfig({
  testDir: './test/qa',
  // QA flows are read-only and run entirely in tutorial mode (reset once up front
  // via the setup chain), so they parallelize safely. Start conservative at 2.
  fullyParallel: true,
  workers: 2,
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
  // Ordered setup chain: log in → reset tutorial → run flows. The reset uses the
  // admin storageState and is best-effort (skips on a non-admin account).
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
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
        command: 'npm run build && npm run start',
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
