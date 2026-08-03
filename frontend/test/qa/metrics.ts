/**
 * QA run metrics (Tests/QA/Evals Arch V3 — measured flows).
 *
 * A per-test fixture that lets flows record structured results — numbers,
 * pass/fail, screenshots — as rows keyed by (flow, metric). Each Playwright
 * worker process writes its own row files under `test/qa/.metrics/rows/`
 * (no cross-worker coordination), and `scripts/qa-report.ts` merges any
 * number of such run directories into a single comparison report.
 *
 * The pass/fail row per declared flow is recorded automatically from
 * `testInfo.status` on teardown, so a flow that fails its own assertions
 * still contributes `pass: false` instead of vanishing from the report.
 *
 * Specs that measure import `test` from HERE (it extends the QA `test`, so
 * the console guard still applies). Non-measuring QA specs are unaffected.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test as qaTest } from './flows';

export const METRICS_DIR = path.join(process.cwd(), 'test/qa/.metrics');
const ROWS_DIR = path.join(METRICS_DIR, 'rows');
const SCREENS_DIR = path.join(METRICS_DIR, 'screens');

export type MetricValue = number | boolean | string;

export interface MetricRow {
  flow: string;
  metric: string;
  value: MetricValue;
  /** How the renderer should treat the value. 'image' values are paths relative to the metrics dir. */
  kind: 'number' | 'pass' | 'image' | 'text';
}

/** Run-level metadata, written once per run (idempotent — every writer emits the same content). */
export interface RunMeta {
  label: string;
  target: string;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export class MetricsRecorder {
  private rows: MetricRow[] = [];
  private flows = new Set<string>();

  constructor(private testInfo: TestInfo) {}

  /**
   * Declare the flow this test measures, BEFORE doing work — this is what
   * guarantees a pass/fail row even when the test dies on its first step.
   */
  flow(name: string): void {
    this.flows.add(name);
  }

  record(flow: string, metric: string, value: number | boolean | string, kind: MetricRow['kind'] = typeof value === 'number' ? 'number' : 'text'): void {
    this.flows.add(flow);
    this.rows.push({ flow, metric, value, kind });
  }

  /**
   * Capture a screenshot under the metrics dir and record it as an image row.
   *
   * Pass `target` to capture one ELEMENT in full — artifact surfaces
   * (stories) size their iframe to content inside an inner scroll container,
   * so neither a viewport shot (crops below the fold) nor fullPage (the app
   * shell's BODY doesn't scroll) sees the whole document; an element capture
   * of the surface iframe does. Without `target`, captures the full page.
   */
  async screenshot(page: Page, flow: string, name: string, target?: Locator): Promise<void> {
    fs.mkdirSync(SCREENS_DIR, { recursive: true });
    const rel = path.join('screens', `${slug(flow)}-${slug(name)}.png`);
    const file = path.join(METRICS_DIR, rel);
    if (target) {
      await target.screenshot({ path: file });
    } else {
      await page.screenshot({ path: file, fullPage: true });
    }
    this.record(flow, name, rel, 'image');
  }

  /** Called by the fixture teardown: append auto pass/fail rows and persist. */
  finalize(): void {
    const passed = this.testInfo.status === this.testInfo.expectedStatus && this.testInfo.status === 'passed';
    for (const flow of this.flows) {
      this.rows.push({ flow, metric: 'pass', value: passed, kind: 'pass' });
    }
    if (this.rows.length === 0) return;
    fs.mkdirSync(ROWS_DIR, { recursive: true });
    const file = path.join(ROWS_DIR, `${this.testInfo.testId}.json`);
    fs.writeFileSync(file, JSON.stringify({ rows: this.rows }, null, 2));
  }
}

/**
 * The measuring QA `test`: the QA test (console guard included) plus a
 * `metrics` recorder that persists on teardown regardless of test outcome.
 */
export const test = qaTest.extend<{ metrics: MetricsRecorder }>({
  metrics: async ({}, use, testInfo) => {
    const recorder = new MetricsRecorder(testInfo);
    await use(recorder);
    recorder.finalize();
  },
});

export { expect } from '@playwright/test';

/**
 * Reset the metrics output dir and stamp run metadata. Runs once per
 * invocation from the Playwright globalSetup, so every `test:qa` run starts
 * with a clean slate and stale rows can never leak into a report.
 */
export function initMetricsDir(): void {
  fs.rmSync(METRICS_DIR, { recursive: true, force: true });
  fs.mkdirSync(ROWS_DIR, { recursive: true });
  const meta: RunMeta = {
    label: process.env.QA_RUN_LABEL || 'qa-run',
    target: process.env.QA_BASE_URL || 'local',
  };
  fs.writeFileSync(path.join(METRICS_DIR, 'meta.json'), JSON.stringify(meta, null, 2));
}
