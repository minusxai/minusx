/**
 * Global file search (e2e, real browser).
 *
 * The cross-page flow: type in the app-shell search box → ranked results from
 * the real server → click one → land on that file's page. Nothing else covers
 * the search bar in a browser, and `searchFilesInFolder` is shared with the
 * agent's SearchFiles tool and MCP, so this guards the whole path end to end.
 *
 * It also pins the in-flight affordance, which is safe to assert here precisely
 * because it does NOT depend on server timing: `pending` is set synchronously
 * on the keystroke and the request is debounced 300ms behind it, so the spinner
 * is on screen for that whole window regardless of how fast the response is.
 * The narrower render-state cases live in components/__tests__/file-search-bar.ui.test.tsx.
 */
import { test, expect } from './fixtures';

// The e2e workspace persists across runs (PGLITE_DATA_DIR data/pglite-e2e), and
// publishing onto a path a previous run already published fails with "a
// published file already exists". Unique per run, so re-runs are independent.
const RUN = String(Date.now());
const NAME = `Quetzal Revenue Breakdown ${RUN}`;
const PATH = `/org/quetzal-revenue-breakdown-${RUN}`;

test('search finds a file, shows progress while it works, and opens the result', async ({ page, request }) => {
  // Distinctive token so ranking cannot confuse this with seeded content.
  const content = { description: 'Quetzal quarterly revenue', query: 'SELECT 1', connection_name: '' };

  const created = await (await request.post('/api/files', {
    data: { name: NAME, path: PATH, type: 'question', content },
  })).json();
  const id = created?.data?.id as number;
  expect(id).toBeTruthy();

  // POST creates a DRAFT, and search excludes drafts (`listAll` filters
  // `draft = false`), so the file is genuinely unfindable until published.
  // PATCH with content is the publish path.
  const published = await (await request.patch(`/api/files/${id}`, {
    data: { name: NAME, path: PATH, content, references: [] },
  })).json();
  expect(published?.data?.draft).toBe(false);

  await page.goto('/');

  const search = page.getByLabel('Search files');
  await expect(search).toBeVisible({ timeout: 30_000 });
  await search.click();
  // Query the run token, not "quetzal": earlier runs leave their own Quetzal
  // files behind, and results are capped at 10 — so a shared term would
  // eventually rank this run's file out of the list.
  await search.fill(RUN);

  // The dropdown must open on the keystroke, not on the response — before the
  // fix this window was a blank screen with no indication anything was running.
  await expect(page.getByLabel('Searching')).toBeVisible();

  const result = page.getByLabel(`Search result: ${NAME}`);
  await expect(result).toBeVisible({ timeout: 30_000 });

  await result.click();
  await expect(page).toHaveURL(new RegExp(`/f/${id}(\\?|$)`), { timeout: 30_000 });
});
