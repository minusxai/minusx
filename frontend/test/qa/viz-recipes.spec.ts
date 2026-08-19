/**
 * Viz recipes QA flow (tutorial mode, real clicks, aria-labels only).
 * `radar` and `heatmap` ship as BUILT-IN recipes on disk (`templates/viz/`), so
 * they resolve in every workspace with no seeding; this flow pins the whole user
 * journey: they surface as Workspace tiles on a question (while the retired
 * static Radar / Heatmap tiles stay absent), clicking one applies it (auto-bound,
 * recipe zones shown), and Save persists a LIVE reference by NAME — served back
 * loader-materialized with the computed spec. The second test covers the other
 * half: browsing the same recipe on the Templates page.
 */
import { expect } from '@playwright/test';
import {
  test,
  e2eUrl,
  findFile,
  openFileByClick,
  assertTutorialMode,
} from './flows';

test('built-in recipes surface as Workspace tiles and apply + save a live reference', async ({ page, request }) => {
  // The tutorial seed carries this question (two categoricals + a measure —
  // exactly the heatmap recipe's slots).
  const question = await findFile(request, 'question', 'Orders by Day of Week and Hour (Last Month)');
  expect(question, 'seeded tutorial question missing').toBeTruthy();

  await openFileByClick(page, 'question', question!);
  await assertTutorialMode(page); // never mutate org/production

  // The built-in recipes resolve into Workspace tiles in every folder…
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

  // The stored artifact is a LIVE reference BY NAME (a built-in has no path);
  // the read path serves it materialized (computed spec attached by the loader),
  // so shipping a changed recipe propagates to this chart.
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
    .toEqual({ kind: 'recipe', recipe: 'heatmap', mark: 'rect' });

  // Hard-check we never left tutorial (QA suite invariant).
  expect(question!.path.startsWith('/tutorial')).toBe(true);
});

test('the built-in radar recipe is browsable on the Templates page', async ({ page }) => {
  // A built-in is not a file, so there is no `/f/<id>` to open: the Templates
  // page IS its viewer, and the only place a user meets it before copying.
  await page.goto(e2eUrl('/templates'));
  await page.getByLabel('Template radar').click();
  await expect(page.getByLabel('Chart recipe')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByLabel('Recipe preview')).toBeVisible();
  await expect(page.getByLabel('Recipe slots')).toBeVisible();
  // A built-in is read-only here, offered as a copy rather than edited in place.
  await expect(page.getByLabel('Copy recipe to my workspace')).toBeVisible();
  // The preview actually DREW the native-vega radar (an svg inside the preview card).
  await expect(page.getByLabel('Recipe preview').locator('svg').first()).toBeVisible({ timeout: 30_000 });
});
