/**
 * Google Sheets QA flow (Tests/QA/Evals Arch V2). Mutating + click-driven, REAL
 * network: import a public spreadsheet into the static connection via the UI,
 * save, then query an imported table from a new question. Covers the whole
 * chain no other test exercises for real: Google export fetch → xlsx → parquet
 * → object store → DuckDB views → query rows in Redux.
 *
 * The spreadsheet is a shared fixture ("Anyone with the link can view", two
 * tabs: "Companies 1" / "Companies 2"). If this flow fails with "not publicly
 * accessible" / "not found", check the sheet's sharing settings first.
 */
import { test, expect } from '@playwright/test';
import {
  QA_MODE,
  findConnection,
  openFileByClick,
  assertTutorialMode,
  gotoTutorialHome,
  createQuestion,
  selectDatabase,
  typeQuery,
  runQuery,
  assertSomeQueryHasRows,
} from './flows';

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1iQ7oEOnUACrUx1MsLwpAKbFBHbqfZgy7iXvgzhVD7k8/edit?usp=sharing';

test('import a public Google Sheet into the static connection and query it', async ({ page, request }) => {
  // Real Google fetch + parquet conversion + save-time schema profiling — generous budget.
  test.setTimeout(600_000);

  const conn = await findConnection(request, 'static');
  test.skip(!conn, 'no static connection on this deployment');

  // Warm the connection's schema cache: the first load after a tutorial reset
  // re-introspects + profiles every table (60s+), and the connection page
  // can't render until that finishes.
  await request.get(`/api/files/${conn!.id}?mode=${QA_MODE}`, { timeout: 180_000 }).catch(() => {});

  // Unique dataset per run: rerun-safe even on deployments where the tutorial
  // reset is skipped (non-admin QA account) — no schema.table collisions.
  const dataset = `qa_sheets_${Date.now()}`;

  await openFileByClick(page, 'connection', conn!);
  await assertTutorialMode(page); // safety net: never mutate org/production

  // Settings → Add Google Sheet → URL + dataset → Import
  await page.getByLabel('Settings view').click({ timeout: 180_000 });
  await page.getByLabel('Add Google Sheet tab').click();
  await page.getByLabel('Dataset name').fill(dataset);
  await page.getByLabel('Spreadsheet URL').first().fill(SHEET_URL);
  await page.getByLabel('Import sheets').click();

  // Import done when the new sheets group renders its re-import affordance
  await page
    .getByLabel('Re-import sheets from this spreadsheet')
    .first()
    .waitFor({ state: 'visible', timeout: 180_000 });

  await page.getByLabel('Save connection').click();

  // Both tabs persisted on the connection document, under /tutorial only.
  // Generous per-request timeout: on a connection with no cached schema the
  // load blocks on introspection + profiling of every table.
  await expect
    .poll(
      async () => {
        const res = await request
          .get(`/api/files/${conn!.id}?mode=${QA_MODE}`, { timeout: 150_000 })
          .catch(() => null);
        if (!res || !res.ok()) return false;
        // GET /api/files/[id] double-wraps non-conversation files: { data: { data: file, metadata } }
        const body = (await res.json())?.data;
        const data = body?.data ?? body;
        if (typeof data?.path !== 'string' || !data.path.startsWith('/tutorial')) return false;
        const files: any[] = data?.content?.config?.files ?? [];
        const tables = files
          .filter((f) => f.schema_name === dataset && f.source_type === 'google_sheets')
          .map((f) => f.table_name);
        return tables.includes('companies_1') && tables.includes('companies_2');
      },
      { message: 'imported sheet tables did not persist on the static connection', timeout: 300_000, intervals: [5_000] },
    )
    .toBe(true);

  // Query the imported table from a brand-new question
  await gotoTutorialHome(page);
  await assertTutorialMode(page);
  await createQuestion(page);
  await selectDatabase(page, 'static');
  await typeQuery(page, `SELECT * FROM ${dataset}.companies_1 LIMIT 5`);
  await runQuery(page);
  // Generous: the query can queue behind the save-triggered schema profiling in DuckDB
  await assertSomeQueryHasRows(page, 180_000);
});
