/**
 * Composable QA flow helpers (Tests/QA/Evals Arch V2 — Phase 5).
 *
 * Reusable building blocks for QA specs. Flows **discover** real content on the
 * target deployment (via `/api/files`) rather than hardcoding seed IDs — so they're
 * portable across deployments with different data. They drive the question/dashboard
 * surfaces with the runtime `?e2e` opt-in and assert against the exposed Redux store.
 */
import { type Page, type APIRequestContext } from '@playwright/test';
import { assertRedux } from '@/test/flows/e2e';

const E2E_SECRET = process.env.QA_E2E_SECRET || 'local-qa-secret';

/** A path with the runtime e2e opt-in appended. */
function e2eUrl(path: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}e2e=${encodeURIComponent(E2E_SECRET)}`;
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
 * Discover an existing file of `type` on the deployment (in the QA user's mode).
 * For questions, prefers one with a SQL query. Returns its id, or null if none.
 */
export async function findFileOfType(request: APIRequestContext, type: 'question' | 'dashboard'): Promise<number | null> {
  const res = await request.get(`/api/files?type=${type}&depth=10&includeContent=true`);
  if (!res.ok()) return null;
  const files: any[] = (await res.json())?.data ?? [];
  if (type === 'question') {
    return (files.find((f) => f?.content?.query) ?? files[0])?.id ?? null;
  }
  return files[0]?.id ?? null;
}

/** Open a file (question or dashboard) by id with the store exposed. */
export async function openFile(page: Page, id: number): Promise<void> {
  await page.goto(e2eUrl(`/f/${id}`));
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
