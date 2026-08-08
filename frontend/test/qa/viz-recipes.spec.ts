/**
 * Workspace viz recipes QA flow (tutorial mode, real clicks, aria-labels only).
 * The workspace template seeds `radar` and `heatmap` as `.viz` files at the
 * tutorial root; this flow pins the whole user journey: the seeded recipes
 * surface as Workspace tiles on a question (while the retired static Radar /
 * Heatmap tiles stay absent), clicking one applies it (auto-bound, recipe
 * zones shown), and Save persists a LIVE reference to the tutorial file —
 * served back loader-materialized with the computed spec.
 */
import { expect } from '@playwright/test';
import {
  test,
  e2eUrl,
  findFile,
  openFileByClick,
  assertTutorialMode,
} from './flows';

test('seeded recipes surface as Workspace tiles and apply + save a live reference', async ({ page, request }) => {
  // The tutorial seed carries this question (two categoricals + a measure —
  // exactly the heatmap recipe's slots).
  const question = await findFile(request, 'question', 'Orders by Day of Week and Hour (Last Month)');
  expect(question, 'seeded tutorial question missing').toBeTruthy();

  await openFileByClick(page, 'question', question!);
  await assertTutorialMode(page); // never mutate org/production

  // The seeded recipe files resolve into Workspace tiles…
  await expect(page.getByLabel('Recipe heatmap')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByLabel('Recipe radar')).toBeVisible();
  // …and the retired static tiles are gone from every grid.
  await expect(page.getByLabel('Heatmap', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Radar', { exact: true })).toHaveCount(0);

  // Apply the heatmap recipe: auto-binds and swaps the Fields zones to the
  // recipe's declared slots.
  await page.getByLabel('Recipe heatmap').click();
  await expect(page.getByLabel('X axis drop zone')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel('Y axis drop zone')).toBeVisible();
  await expect(page.getByLabel('Value drop zone')).toBeVisible();
  await expect(page.getByLabel('Recipe heatmap')).toHaveAttribute('aria-pressed', 'true');

  // An already-saved question saves directly (no name dialog).
  await page.getByLabel('Save', { exact: true }).click();

  // The stored artifact is a LIVE reference to the tutorial recipe file; the
  // read path serves it materialized (computed spec attached by the loader),
  // so recipe edits propagate to this chart.
  await expect
    .poll(async () => {
      const res = await request.get(`/api/files/${question!.id}?mode=tutorial`);
      if (!res.ok()) return null;
      const body = await res.json();
      const file = body?.data?.data ?? body?.data;
      const source = file?.content?.viz?.source;
      return source
        ? { kind: source.kind, recipe: source.recipe, mark: source.spec?.mark }
        : null;
    }, { timeout: 30_000 })
    .toEqual({ kind: 'recipe', recipe: '/tutorial/heatmap', mark: 'rect' });

  // Hard-check we never left tutorial (QA suite invariant).
  expect(question!.path.startsWith('/tutorial')).toBe(true);
});

test('the seeded radar recipe file opens with a sample-data preview', async ({ page, request }) => {
  const res = await request.get(`/api/files/by-path?path=${encodeURIComponent('/tutorial/radar')}&mode=tutorial`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  const radar = body?.data?.data ?? body?.data;
  expect(radar?.type).toBe('viz');

  await page.goto(e2eUrl(`/f/${radar.id}`));
  await expect(page.getByLabel('Chart recipe')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByLabel('Recipe preview')).toBeVisible();
  await expect(page.getByLabel('Recipe slots')).toBeVisible();
  // The preview actually DREW the native-vega radar (an svg inside the preview card).
  await expect(page.getByLabel('Recipe preview').locator('svg').first()).toBeVisible({ timeout: 30_000 });
});
