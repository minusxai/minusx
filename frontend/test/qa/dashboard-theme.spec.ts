/**
 * Themed-dashboard QA flow (Renderer_v2 Phase 6b). Mutating + click-driven for everything that
 * HAS a click path: create a dashboard, add a question, save. `content.theme` has NO UI — it is
 * an agent-set content field (skill_dashboards) — so it is written via the files API; what this
 * flow verifies is the RENDERER: the reopened dashboard stamps `data-theme`, resolves the theme's
 * token set (chart palette departs from the app default), and renders inside the live-svg
 * surface (Option B2). Stays entirely in tutorial mode.
 */
import { test, expect } from '@playwright/test';
import {
  gotoTutorialHome,
  assertTutorialMode,
  createDashboard,
  addFirstQuestion,
  saveDraft,
  e2eUrl,
  QA_MODE,
} from './flows';

test('themed dashboard: data-theme stamped, theme tokens live, rendered in the svg surface', async ({ page, request }) => {
  await gotoTutorialHome(page);
  await assertTutorialMode(page); // safety net: never mutate org/production

  const dashboardId = await createDashboard(page);
  await addFirstQuestion(page);
  await saveDraft(page, `qa-dash-theme-${Date.now()}`);

  // Set the agent-authored theme field (no click path exists for it by design).
  const fileRes = await request.get(e2eUrl(`/api/files/${dashboardId}?mode=${QA_MODE}`));
  expect(fileRes.ok()).toBeTruthy();
  const file = (await fileRes.json()).data;
  expect(file.path.startsWith('/tutorial')).toBeTruthy(); // loud safety net
  const patch = await request.patch(e2eUrl(`/api/files/${dashboardId}?mode=${QA_MODE}`), {
    data: { name: file.name, path: file.path, content: { ...file.content, theme: 'nocturne' } },
  });
  expect(patch.ok()).toBeTruthy();

  // Reopen and verify the RENDERER end-to-end.
  await page.goto(e2eUrl(`/f/${dashboardId}`));
  const region = page.getByLabel('Dashboard', { exact: true });
  await expect(region).toHaveAttribute('data-theme', 'nocturne', { timeout: 30_000 });

  // The theme's token set actually applies: --chart-1 departs from the app-default palette.
  const chart1 = await region.evaluate((el) => getComputedStyle(el).getPropertyValue('--chart-1').trim());
  expect(chart1).not.toBe('');
  expect(chart1.toLowerCase()).not.toBe('#16a085');

  // And the themed region lives inside the live-svg surface (B2), inside the capture anchor.
  await expect(page.locator('[data-file-id] svg[data-mx-surface-svg] foreignObject [aria-label="Dashboard"]')).toBeVisible();
});
