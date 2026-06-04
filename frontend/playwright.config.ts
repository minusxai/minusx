import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Playwright E2E config (Tests/QA/Evals Arch V2 — Phase 4).
 *
 * Boots the real Next app under E2E_MODE (faux LLM via /api/test/faux, charts as
 * SVG, store on window.__MX_STORE__) against an isolated PGLite DB. Auth is
 * established once by the `setup` project (register + login via the dev
 * email===password shortcut) and reused via storageState.
 *
 * Local/CI use the SAME flows; only QA (Phase 5) swaps baseURL to prod + real LLM.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
// process.cwd() is the frontend/ dir (where `npx playwright test` runs); avoids
// __dirname, which is undefined under this ESM ("type":"module") project.
const AUTH_FILE = path.join(process.cwd(), 'test/e2e/.auth/admin.json');
const PGLITE_DIR = path.join(process.cwd(), 'data/pglite-e2e');
// PGLite's adapter mkdir is non-recursive; ensure the dir exists before boot.
fs.mkdirSync(PGLITE_DIR, { recursive: true });

export default defineConfig({
  testDir: './test/e2e',
  // tutorial reset is global-per-company → serialize to avoid runs stomping each other.
  fullyParallel: false,
  workers: 1,
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
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      PORT: String(PORT),
      NEXT_PUBLIC_E2E: 'true',
      E2E_MODE: 'true',
      // Own build dir so this server doesn't fight a running `next dev` for .next/dev/lock.
      NEXT_DIST_DIR: '.next-e2e',
      DB_TYPE: 'pglite',
      PGLITE_DATA_DIR: PGLITE_DIR,
    },
  },
});
