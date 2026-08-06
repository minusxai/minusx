/**
 * QA run metrics — measured flows.
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
import { test as qaTest, fitViewportToSurface, fileCaptureUrl } from './flows';
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
 * Hard ceiling per variant. Neither `page.evaluate` nor `locator.screenshot`
 * carries a timeout of its own, so an in-page capture that never settles hangs
 * the FLOW — and because the eval's test timeout is longer than the CI job's,
 * that surfaces as a cancelled job with no failing test and no log. "Best
 * effort" has to cover a hang, not just a throw; this is what makes it true.
 */
const CAPTURE_TIMEOUT_MS = 90_000;

/** Reject if `work` outstays `ms`. The timer never keeps the process alive. */
async function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} exceeded ${ms}ms`)), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Capture a file view through the APP's own capture path, in page. This is the
 * same function behind ReviewFile and the dev panel's "Get image" — serialize
 * the live surface into `<svg><foreignObject>` and rasterize it — not a
 * reimplementation, which is the entire point of offering it as a renderer
 * beside Playwright's compositor screenshot.
 *
 * The hook is installed only under the E2E build flag or the QA runtime opt-in
 * (`?e2e=<secret>`), the same gate that exposes `window.__MX_STORE__`.
 *
 * `maxWidth` is the DEVICE width, not the app's display cap: capping at 1536
 * upscaled a 708px canvas by 2.2x — the same layout, enlarged and soft, at four
 * times the bytes. At device width the app renderer and the Playwright one
 * produce the same pixel dimensions, which is the only way the two are
 * comparable in the report.
 */
async function captureViaApp(page: Page, fileId: number, maxWidth: number): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    async ({ key, id, width }) => {
      const hook = (window as unknown as Record<string, unknown>)[key];
      if (typeof hook !== 'function') {
        throw new Error(`window.${key} is not installed — is the e2e runtime opt-in active on this page?`);
      }
      return (await hook({ fileId: id, maxWidth: width })) as string;
    },
    { key: E2E_CAPTURE_KEY, id: fileId, width: maxWidth },
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
   * Capture the image row for `(flow, name)` in EVERY variant — each device
   * width × each renderer — and record one row per captured file. The report
   * shows one at a time behind its settings toggle; it cannot re-capture after
   * the run, so the matrix is produced here or not at all.
   *
   * The question each image answers is "what does this document look like on a
   * laptop / on a phone", so the DOCUMENT must own the viewport. With `fileId`
   * the page is therefore RELOADED per width at `view=contentonly`
   * (`fileCaptureUrl`) — chrome-free, so canvas width == device width — rather
   * than resized in place inside the app shell, where the side chat and rails
   * leave a story 708px of a 1280px window and collapse its container-query
   * bands into a layout no reader sees. Reloading per width (instead of
   * resizing once) is also how a real device arrives: first layout at that
   * width, no resize artifacts.
   *
   * `fileId` is the whole contract for a file: it selects the capture page,
   * anchors BOTH renderers to `[data-file-id]` (the same box, so a pair differs
   * only by renderer), and enables the `download` one — the APP's own capture
   * (`lib/screenshot/capture.ts`, what ReviewFile and dev-tools "Get image"
   * produce), which has no `[data-file-id]` view to photograph without it.
   * The capture is of that ELEMENT, not the viewport: a surface sizes its
   * iframe to content inside an inner scroll container, so neither a viewport
   * shot (crops below the fold) nor fullPage (the app shell's BODY doesn't
   * scroll) sees the whole document.
   *
   * `target` is the fallback for a page with no file view (a chat transcript,
   * say); with `fileId` it is ignored, and with neither the full page is taken.
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
    const returnTo = page.url();
    try {
      for (const size of IMAGE_SIZES) {
        const width = VIEWPORT_WIDTH_PX[size];
        await page.setViewportSize({ width, height: original.height });
        if (opts.fileId !== undefined) {
          await page.goto(fileCaptureUrl(opts.fileId));
          await this.waitForCaptureTarget(page, opts.fileId, `${flow}/${name} ${size}`);
        }
        await page.waitForTimeout(RELAYOUT_MS);
        for (const renderer of IMAGE_RENDERERS) {
          await this.captureVariant(page, flow, name, { size, renderer }, opts);
        }
      }
    } finally {
      await page.setViewportSize(original);
      // Leave the page where the flow had it: later steps (and the console
      // guard's view of the run) must not inherit a chrome-less capture page.
      await page.goto(returnTo).catch(() => {});
    }
  }

  /**
   * Wait for the freshly loaded capture page to be worth photographing: the
   * file view mounted, and its surface present. Best-effort — a capture of a
   * half-rendered page is better evidence than no capture at all.
   */
  private async waitForCaptureTarget(page: Page, fileId: number, label: string): Promise<void> {
    try {
      await page.locator(`[data-file-id="${fileId}"]`).waitFor({ state: 'visible', timeout: 60_000 });
    } catch (error) {
      console.warn(`[metrics] ${label}: capture page never settled:`, error);
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
    const label = `${flow}/${name} ${variant.size}:${variant.renderer}`;
    // Both renderers must photograph the SAME box, or the two images differ by
    // more than the renderer under test. The app capture is anchored to
    // `[data-file-id]`, so the Playwright one is too — capturing the surface
    // iframe instead cropped the file view's own padding and made every pair
    // disagree on width (1184 vs 1280).
    const target = opts.fileId !== undefined ? page.locator(`[data-file-id="${opts.fileId}"]`) : opts.target;
    // Progress on stdout: a capture matrix is minutes of otherwise silent work
    // in the CI log, and silence is indistinguishable from a hang.
    console.log(`[metrics] capturing ${label}`);
    try {
      if (variant.renderer === 'download') {
        if (opts.fileId === undefined) return;
        // 1:1 with the live element. `maxWidth` doesn't only cap — the app
        // derives its raster scale from it, so ANY value other than the
        // element's own CSS width rescales: the device width upscaled a 1184px
        // view to 1280, and the display cap upscaled it to 1536. Measuring
        // first is what makes this pair comparable with the Playwright shot.
        const box = await target?.boundingBox();
        const cssWidth = Math.round(box?.width ?? VIEWPORT_WIDTH_PX[variant.size]);
        fs.writeFileSync(
          file,
          await withTimeout(captureViaApp(page, opts.fileId, cssWidth), CAPTURE_TIMEOUT_MS, label),
        );
      } else if (target) {
        // Chromium composites iframe content only INSIDE the viewport, so a
        // full-artifact element capture must grow the viewport to the surface
        // height first — otherwise everything below the fold captures black.
        // `restore` runs even when the capture times out: leaving the viewport
        // grown would corrupt every later variant.
        const restore = await fitViewportToSurface(page, target);
        try {
          await page.waitForTimeout(SETTLE_MS);
          await withTimeout(
            target.screenshot({ path: file, timeout: CAPTURE_TIMEOUT_MS }),
            CAPTURE_TIMEOUT_MS,
            label,
          );
        } finally {
          await restore();
        }
      } else {
        await withTimeout(
          page.screenshot({ path: file, fullPage: true, timeout: CAPTURE_TIMEOUT_MS }),
          CAPTURE_TIMEOUT_MS,
          label,
        );
      }
    } catch (error) {
      console.warn(`[metrics] ${label} capture failed:`, error);
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
