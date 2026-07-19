/**
 * Story rendering across all three renderers (e2e, real browser). The story pipeline is the biggest
 * recent investment with NO full-app coverage: the "Story Renderer" setting (dom | canvas | svg) picks
 * a fundamentally different surface, and only a real browser can prove each one actually mounts.
 *
 *   - dom    → an <iframe> hosting the story body (no <svg> surface, no <canvas>)
 *   - canvas → a takumi-rastered <canvas>
 *   - svg    → an <iframe> whose body is wrapped in <svg><foreignObject>
 *
 * The setting is workspace-level (resolved from the org config), so it's flipped via POST /api/configs
 * and the page reloaded between renderers. Rendering needs no query connector (the story is static
 * HTML), so this runs cleanly under E2E_MODE.
 */
import { test, expect } from './fixtures';

const TALL_STORY = `<div style="max-width:1000px;margin:0 auto;padding:24px;">${
  [1, 2, 3, 4].map((i) => `
    <section style="min-height:520px;padding:40px;background:${i % 2 ? '#0d1117' : '#161b22'};color:#e6edf3;border-radius:12px;margin-bottom:16px;">
      <h2 style="font-size:28px;">Section ${i}</h2>
      <p style="font-size:16px;max-width:640px;">A tall test story so the surface spans multiple viewport heights under every renderer.</p>
    </section>`).join('')
}</div>`;

test('a story renders under the DOM, canvas, and SVG renderers', async ({ page, request }) => {
  // Create the story via the API (deterministic; the e2e workspace has none seeded).
  const created = await (await request.post('/api/files', {
    data: { name: 'E2E Story', path: '/org/e2e-story', type: 'story', content: { story: TALL_STORY } },
  })).json();
  const id = created?.data?.id as number;
  expect(id).toBeTruthy();

  const container = page.locator(`[data-file-id="${id}"]`);
  const setRenderer = (r: 'dom' | 'canvas' | 'svg') => request.post('/api/configs', { data: { storyRenderer: r } });

  // ── DOM: an iframe surface, no canvas ────────────────────────────────────────────────────────
  await setRenderer('dom');
  await page.goto(`/f/${id}`);
  await expect(page.getByLabel('Story page')).toBeVisible({ timeout: 30_000 });
  await expect(container.locator('iframe')).toHaveCount(1, { timeout: 30_000 });
  await expect(container.locator('canvas')).toHaveCount(0);
  // The DOM surface renders the body directly in the iframe — NOT wrapped in an <svg>.
  await expect(page.frameLocator(`[data-file-id="${id}"] iframe`).locator('svg')).toHaveCount(0);

  // ── Canvas: a takumi-rastered <canvas> ───────────────────────────────────────────────────────
  await setRenderer('canvas');
  await page.goto(`/f/${id}`);
  await expect(page.getByLabel('Story page')).toBeVisible({ timeout: 30_000 });
  await expect(container.locator('canvas')).toHaveCount(1, { timeout: 30_000 });

  // ── SVG: an iframe whose body is wrapped in <svg><foreignObject> ──────────────────────────────
  await setRenderer('svg');
  await page.goto(`/f/${id}`);
  await expect(page.getByLabel('Story page')).toBeVisible({ timeout: 30_000 });
  await expect(container.locator('iframe')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.frameLocator(`[data-file-id="${id}"] iframe`).locator('svg foreignObject')).toHaveCount(1, { timeout: 30_000 });
});
