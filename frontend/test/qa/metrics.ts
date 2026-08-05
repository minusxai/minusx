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
import { test as qaTest, fitViewportToSurface } from './flows';
import { IMAGE_SIZES, IMAGE_RENDERERS, VIEWPORT_WIDTH_PX, type ImageVariant } from './image-variants';
import { E2E_CAPTURE_KEY } from '@/lib/screenshot/constants';

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
  /**
   * Image rows only: which capture this file is. One image metric produces one
   * row per variant; the report shows one at a time (see `image-variants.ts`).
   * Absent = the default variant, so pre-matrix runs still render.
   */
  variant?: ImageVariant;
}

/** Run-level metadata, written once per run (idempotent — every writer emits the same content). */
export interface RunMeta {
  label: string;
  target: string;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Reflow budget after a viewport resize: embeds re-measure and re-lay-out. */
const RELAYOUT_MS = 5_000;
/** Post-fit settle: relayout + lazily mounted sections + charts. */
const SETTLE_MS = 5_000;

/**
 * Capture a file view through the APP's own capture path, in page. This is the
 * same function behind ReviewFile and the dev panel's "Get image" — serialize
 * the live surface into `<svg><foreignObject>` and rasterize it — not a
 * reimplementation, which is the entire point of offering it as a renderer
 * beside Playwright's compositor screenshot.
 *
 * The hook is installed only under the E2E build flag or the QA runtime opt-in
 * (`?e2e=<secret>`), the same gate that exposes `window.__MX_STORE__`.
 */
async function captureViaApp(page: Page, fileId: number): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    async ({ key, id }) => {
      const hook = (window as unknown as Record<string, unknown>)[key];
      if (typeof hook !== 'function') {
        throw new Error(`window.${key} is not installed — is the e2e runtime opt-in active on this page?`);
      }
      return (await hook({ fileId: id })) as string;
    },
    { key: E2E_CAPTURE_KEY, id: fileId },
  );
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
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

  record(
    flow: string,
    metric: string,
    value: number | boolean | string,
    kind: MetricRow['kind'] = typeof value === 'number' ? 'number' : 'text',
    variant?: ImageVariant,
  ): void {
    this.flows.add(flow);
    this.rows.push({ flow, metric, value, kind, ...(variant ? { variant } : {}) });
  }

  /**
   * Capture the image row for `(flow, name)` in EVERY variant — each size ×
   * each renderer — and record one row per captured file. The report shows one
   * at a time behind its settings toggle; it cannot re-capture after the run,
   * so the matrix is produced here or not at all (`image-variants.ts`).
   *
   * Pass `target` to capture one ELEMENT in full — artifact surfaces (stories)
   * size their iframe to content inside an inner scroll container, so neither a
   * viewport shot (crops below the fold) nor fullPage (the app shell's BODY
   * doesn't scroll) sees the whole document; an element capture of the surface
   * iframe does. Without `target`, captures the full page.
   *
   * Pass `fileId` to additionally capture through the APP's own capture path
   * (`lib/screenshot/capture.ts` — what ReviewFile and dev-tools "Get image"
   * produce). Without it the `download` renderer is skipped for this row: there
   * is no `[data-file-id]` view for the app to capture.
   *
   * Every capture is best-effort. A variant that throws is warned and omitted —
   * instrumentation must never fail the flow it is measuring.
   */
  async screenshot(
    page: Page,
    flow: string,
    name: string,
    opts: { target?: Locator; fileId?: number } = {},
  ): Promise<void> {
    fs.mkdirSync(SCREENS_DIR, { recursive: true });
    const original = page.viewportSize() ?? { width: VIEWPORT_WIDTH_PX.laptop, height: 720 };
    try {
      for (const size of IMAGE_SIZES) {
        // Width is a LAYOUT input: the surface tracks its container, so this is
        // what makes the mobile shot a mobile layout rather than a scaled one.
        await page.setViewportSize({ width: VIEWPORT_WIDTH_PX[size], height: original.height });
        await page.waitForTimeout(RELAYOUT_MS);
        for (const renderer of IMAGE_RENDERERS) {
          await this.captureVariant(page, flow, name, { size, renderer }, opts);
        }
      }
    } finally {
      await page.setViewportSize(original);
    }
  }

  private async captureVariant(
    page: Page,
    flow: string,
    name: string,
    variant: ImageVariant,
    opts: { target?: Locator; fileId?: number },
  ): Promise<void> {
    const rel = path.join('screens', `${slug(flow)}-${slug(name)}-${variant.size}-${variant.renderer}.png`);
    const file = path.join(METRICS_DIR, rel);
    try {
      if (variant.renderer === 'download') {
        if (opts.fileId === undefined) return;
        fs.writeFileSync(file, await captureViaApp(page, opts.fileId));
      } else if (opts.target) {
        // Chromium composites iframe content only INSIDE the viewport, so a
        // full-artifact element capture must grow the viewport to the surface
        // height first — otherwise everything below the fold captures black.
        const restore = await fitViewportToSurface(page, opts.target);
        await page.waitForTimeout(SETTLE_MS);
        await opts.target.screenshot({ path: file });
        await restore();
      } else {
        await page.screenshot({ path: file, fullPage: true });
      }
    } catch (error) {
      console.warn(`[metrics] ${flow}/${name} ${variant.size}:${variant.renderer} capture failed:`, error);
      return;
    }
    this.record(flow, name, rel, 'image', variant);
  }

  /** Called by the fixture teardown: append auto pass/fail rows and persist. */
  finalize(): void {
    // The console guard asserts AFTER this teardown, so its verdict must be
    // read from the collected violations directly — otherwise a flow the
    // guard is about to fail (e.g. a story whose authored queries error in
    // the browser) would be reported as PASS while the job goes red.
    const guardViolations =
      (this.testInfo as { qaConsoleViolations?: () => readonly string[] }).qaConsoleViolations?.() ?? [];
    const passed =
      this.testInfo.status === this.testInfo.expectedStatus &&
      this.testInfo.status === 'passed' &&
      guardViolations.length === 0;
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
