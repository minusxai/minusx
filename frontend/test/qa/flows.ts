/**
 * Composable QA flow helpers (Tests/QA/Evals Arch V2 — Phase 5).
 *
 * Reusable building blocks for QA specs. Flows **discover** real content on the
 * target deployment (via `/api/files`) rather than hardcoding seed IDs — so they're
 * portable across deployments with different data. They drive the question/dashboard
 * surfaces with the runtime `?e2e` opt-in and assert against the exposed Redux store.
 */
import { expect, type Page, type APIRequestContext } from '@playwright/test';
import { assertRedux } from '@/test/flows/e2e';

const E2E_SECRET = process.env.QA_E2E_SECRET || 'local-qa-secret';

/**
 * QA flows operate EXCLUSIVELY on tutorial mode — never production (org) files.
 * Every page nav and `/api/files` discovery call carries `mode=tutorial`, so
 * discovery, navigation, and query execution all stay inside the isolated
 * tutorial filesystem + seed warehouse.
 */
export const QA_MODE = 'tutorial';

/** Append a query param to a path, picking `?` or `&` automatically. */
function withParam(path: string, kv: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}${kv}`;
}

/** A path pinned to tutorial mode (no e2e opt-in) — for gate/negative checks. */
export function modeUrl(path: string): string {
  return withParam(path, `mode=${QA_MODE}`);
}

/** A path with the runtime e2e opt-in + tutorial mode appended. */
export function e2eUrl(path: string): string {
  return withParam(modeUrl(path), `e2e=${encodeURIComponent(E2E_SECRET)}`);
}

/**
 * Best-effort reset of tutorial + internals modes to the pristine template seed
 * (admin-only). Useful for isolation/mutation where the QA account is an admin; on
 * deployments where it isn't (or the endpoint errors), it's skipped + logged. The
 * read-only flows below don't depend on it. Returns whether the reset ran.
 */
export async function resetTutorial(request: APIRequestContext): Promise<boolean> {
  const res = await request.post('/api/admin/reset-tutorial');
  if (!res.ok()) {
    // eslint-disable-next-line no-console
    console.warn(`[qa] reset-tutorial skipped (HTTP ${res.status()}) — proceeding with existing content`);
    return false;
  }
  return true;
}

/**
 * Wait until the tutorial mxfood sample data has finished copying (registration
 * kicks that off fire-and-forget). Polls /api/orgs/seed-status. Returns true once
 * ready; returns true immediately if the endpoint is absent (older deployment —
 * assume its long-lived data already exists). Returns false on timeout.
 */
export async function waitForTutorialData(request: APIRequestContext, timeoutMs = 120_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request.get(`/api/orgs/seed-status?mode=${QA_MODE}`);
    if (res.status() === 404) return true; // endpoint not deployed — assume data already seeded
    if (res.ok() && (await res.json())?.data?.ready) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

/**
 * Discover an existing file of `type` in tutorial mode on the deployment.
 * For questions, prefers one with a SQL query. Returns { id, name }, or null.
 * The name lets flows open the file by *clicking* its tile (real navigation).
 */
export async function findFile(
  request: APIRequestContext,
  type: 'question' | 'dashboard',
): Promise<{ id: number; name: string; path: string } | null> {
  const res = await request.get(`/api/files?type=${type}&depth=10&includeContent=true&mode=${QA_MODE}`);
  if (!res.ok()) return null;
  const files: any[] = (await res.json())?.data ?? [];
  const file = type === 'question' ? (files.find((f) => f?.content?.query) ?? files[0]) : files[0];
  return file ? { id: file.id, name: file.name, path: file.path } : null;
}

/**
 * Open a file by navigating to its parent folder, then CLICKING its tile — real
 * user navigation, not a URL jump to /f/{id}. Opening the parent folder (derived
 * from the file's path) keeps this robust to nested files across deployments.
 * Expands the file's section first if collapsed (Questions is collapsed by
 * default). Mode is preserved by e2eUrl + the tile href.
 */
export async function openFileByClick(
  page: Page,
  type: 'question' | 'dashboard',
  file: { name: string; path: string },
): Promise<void> {
  const parent =
    file.path && file.path.lastIndexOf('/') > 0
      ? file.path.slice(0, file.path.lastIndexOf('/'))
      : `/${QA_MODE}`;
  await page.goto(e2eUrl(`/p${parent}`));
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).__MX_STORE__?.getState === 'function'), { timeout: 15_000 })
    .toBe(true);

  const tile = page.getByLabel(file.name, { exact: true }).first();
  if (!(await tile.isVisible().catch(() => false))) {
    const sectionLabel = type === 'question' ? 'Questions section' : 'Dashboards section';
    await page.getByLabel(sectionLabel).first().click().catch(() => {}); // expand if collapsed
  }
  // Wait for the listing to render the tile before clicking (cold first loads can be slow).
  await tile.waitFor({ state: 'visible', timeout: 30_000 });
  await tile.click({ timeout: 30_000 });
  await page.waitForURL(/\/f\/\d+/, { timeout: 20_000 });
}

/** Click the question's Run-query control if present; else rely on auto-execute. */
export async function runQuery(page: Page): Promise<void> {
  await page.getByLabel('Run query').click({ timeout: 10_000 }).catch(() => {});
}

/** Assert at least one query result in Redux has rows (a query ran and returned data). */
export async function assertSomeQueryHasRows(page: Page): Promise<void> {
  await assertRedux(
    page,
    (s) => {
      const results = s?.queryResults?.results ?? {};
      return Object.values(results).some(
        (r: any) => !r.loading && Array.isArray(r?.data?.rows) && r.data.rows.length > 0,
      );
    },
    { message: 'no query result with rows landed in Redux', timeout: 45_000 },
  );
}

/** Assert a dashboard loaded its file and at least `minQuestions` of its questions returned rows. */
export async function assertDashboardRendered(page: Page, dashboardId: number, minQuestions = 1): Promise<void> {
  await assertRedux(
    page,
    (s) => {
      const file = s?.files?.files?.[dashboardId];
      if (!file) return false;
      const withRows = (Object.values(s?.queryResults?.results ?? {}) as any[]).filter(
        (r) => !r.loading && Array.isArray(r?.data?.rows) && r.data.rows.length > 0,
      );
      return withRows.length >= minQuestions;
    },
    { message: `dashboard ${dashboardId} did not render ${minQuestions}+ question result(s)`, timeout: 45_000 },
  );
}

// ---------------------------------------------------------------------------
// Mutating flows (create / edit / save). These author NEW files, so they:
//   1. enter via a tutorial-mode page (so auth.user.mode === 'tutorial'),
//   2. assert that mode before mutating (assertTutorialMode), and
//   3. hard-assert created paths start with /tutorial — a loud safety net so a
//      regression in mode-preservation can never silently write to production.
// They create uniquely-named artifacts and assert by their own id, so they are
// safe under parallel workers (reset runs once up front; nothing is shared).
// ---------------------------------------------------------------------------

/** Land on the tutorial home with the store exposed + mode=tutorial established. */
export async function gotoTutorialHome(page: Page): Promise<void> {
  await page.goto(e2eUrl('/p/tutorial'));
  // Wait for the e2e gate to expose the store before any Redux assertion.
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).__MX_STORE__?.getState === 'function'), {
      timeout: 15_000,
    })
    .toBe(true);
}

/** Safety guard: refuse to mutate unless Redux confirms we're in tutorial mode. */
export async function assertTutorialMode(page: Page): Promise<void> {
  await assertRedux(
    page,
    (s) => s?.auth?.user?.mode === QA_MODE,
    { message: `expected auth.user.mode === '${QA_MODE}' before mutating`, timeout: 15_000 },
  );
}

/** Click Create → New Dashboard; returns the new draft dashboard's file id. */
export async function createDashboard(page: Page): Promise<number> {
  await page.getByLabel('Create').first().click();
  await page.getByLabel('New Dashboard').click();
  await page.waitForURL(/\/f\/\d+/, { timeout: 20_000 });
  return Number(new URL(page.url()).pathname.split('/f/')[1]);
}

/** Add the first available tutorial question to the open dashboard via its panel. */
export async function addFirstQuestion(page: Page): Promise<void> {
  await page.getByLabel('Add to dashboard').first().click({ timeout: 20_000 });
}

/** Save a draft via the header Save → SaveFileModal (name + confirm). */
export async function saveDraft(page: Page, name: string): Promise<void> {
  // exact: 'Save' would otherwise also match "Review N unsaved changes".
  await page.getByLabel('Save', { exact: true }).click();
  await page.getByLabel('File name').fill(name);
  await page.getByLabel('Confirm save').click();
}

/** Click Create → New Question; returns the new draft question's file id. */
export async function createQuestion(page: Page): Promise<number> {
  await page.getByLabel('Create').first().click();
  await page.getByLabel('New Question').click();
  await page.waitForURL(/\/f\/\d+/, { timeout: 20_000 });
  return Number(new URL(page.url()).pathname.split('/f/')[1]);
}

/** Type SQL into the Monaco editor (located via its ariaLabel) and dismiss popups. */
export async function typeQuery(page: Page, sql: string): Promise<void> {
  // Focus (not click) — Monaco's render layers intercept pointer events on the input.
  await page.getByLabel('SQL editor').focus();
  await page.keyboard.type(sql);
  await page.keyboard.press('Escape'); // dismiss any autocomplete suggestion popup
}

/** Assert a question is saved (not draft), under /tutorial, with a non-empty query. */
export async function assertQuestionSaved(page: Page, questionId: number): Promise<void> {
  await assertRedux(
    page,
    (s) => {
      const f = s?.files?.files?.[questionId];
      if (!f || f.draft) return false;
      const content = { ...(f.content ?? {}), ...(f.persistableChanges ?? {}) };
      const inTutorial = typeof f.path === 'string' && f.path.startsWith('/tutorial');
      return inTutorial && typeof content.query === 'string' && content.query.trim().length > 0;
    },
    { message: `question ${questionId} not saved under /tutorial with a query`, timeout: 20_000 },
  );
}

/** Assert a dashboard is saved (not draft), under /tutorial, and holds a question. */
export async function assertDashboardSavedWithQuestion(page: Page, dashboardId: number): Promise<void> {
  await assertRedux(
    page,
    (s) => {
      const f = s?.files?.files?.[dashboardId];
      if (!f || f.draft) return false;
      const content = { ...(f.content ?? {}), ...(f.persistableChanges ?? {}) };
      const assets: any[] = content?.assets ?? [];
      const hasQuestion = assets.some((a) => a?.type === 'question');
      const inTutorial = typeof f.path === 'string' && f.path.startsWith('/tutorial');
      return hasQuestion && inTutorial;
    },
    { message: `dashboard ${dashboardId} not saved under /tutorial with a question`, timeout: 20_000 },
  );
}
