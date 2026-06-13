/**
 * CSV upload QA flow (Tests/QA/Evals Arch V2). Mutating + click-driven: upload a
 * fixture CSV into the static connection via the UI, save, then query the
 * uploaded table from a new question. Covers the upload-UI half of the static
 * connection (CSV → parquet → object store → DuckDB) that the Google Sheets flow
 * (sheets-flow.spec.ts) does not — the query side downstream is shared.
 *
 * Tutorial mode only; unique dataset per run so it is rerun-safe even where the
 * tutorial reset is skipped (non-admin QA account).
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
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

// QA config runs from frontend/ (cwd) — matches the AUTH_FILE path in playwright.qa.config.ts.
const FIXTURE = path.join(process.cwd(), 'test', 'qa', 'fixtures', 'qa_upload.csv');
// qa_upload.csv → sanitizeTableName strips the extension → table "qa_upload"
const TABLE = 'qa_upload';

test('upload a CSV into the static connection and query it', async ({ page, request }) => {
  // Parquet conversion + save-time schema profiling — generous budget.
  test.setTimeout(300_000);

  const conn = await findConnection(request, 'static');
  test.skip(!conn, 'no static connection on this deployment');

  // Warm the schema cache: the first load after a tutorial reset re-introspects
  // every table before the connection page can render.
  await request.get(`/api/files/${conn!.id}?mode=${QA_MODE}`, { timeout: 180_000 }).catch(() => {});

  const dataset = `qa_csv_${Date.now()}`;

  await openFileByClick(page, 'connection', conn!);
  await assertTutorialMode(page); // safety net: never mutate org/production

  // Settings → Upload CSV → pick file → dataset name → Upload.
  // The CSV upload panel is open by DEFAULT (activePanel initializes to
  // 'csv-upload'), so clicking the tab would TOGGLE it closed. Only click it if
  // the panel isn't already showing its file input.
  await page.getByLabel('Settings view').click({ timeout: 180_000 });
  const fileInput = page.getByLabel('CSV file input');
  if ((await fileInput.count()) === 0) {
    await page.getByLabel('Upload CSV tab').click();
    await fileInput.waitFor({ state: 'attached', timeout: 30_000 });
  }
  await fileInput.setInputFiles(FIXTURE);
  await page.getByLabel('CSV dataset name').fill(dataset);
  await page.getByLabel('Upload files').click();

  // Upload done when the success affordance renders, then persist
  await page.getByLabel('Upload succeeded').waitFor({ state: 'visible', timeout: 120_000 });
  await page.getByLabel('Save connection').click();

  // The uploaded table persisted on the connection document, under /tutorial only.
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
        return files.some(
          (f) => f.schema_name === dataset && f.table_name === TABLE && f.source_type === 'csv',
        );
      },
      { message: 'uploaded CSV table did not persist on the static connection', timeout: 300_000, intervals: [5_000] },
    )
    .toBe(true);

  // Query the uploaded table from a brand-new question
  await gotoTutorialHome(page);
  await assertTutorialMode(page);
  await createQuestion(page);
  await selectDatabase(page, 'static');
  await typeQuery(page, `SELECT region, SUM(revenue) AS total FROM ${dataset}.${TABLE} GROUP BY region`);
  await runQuery(page);
  // Generous: the query can queue behind save-triggered schema profiling in DuckDB
  await assertSomeQueryHasRows(page, 180_000);
});
