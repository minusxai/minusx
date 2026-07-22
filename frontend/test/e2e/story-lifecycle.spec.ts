/**
 * Story rendering (e2e, real browser). The svg surface is the ONLY story render path
 * (Story_Design_V2 §4): stories mount as an <iframe> whose body is wrapped in
 * <svg><foreignObject> — there is no renderer setting. Only a real browser can prove the
 * surface actually mounts. Rendering needs no query connector (the story is static HTML),
 * so this runs cleanly under E2E_MODE.
 */
import { test, expect } from './fixtures';

const TALL_STORY = `<div style="max-width:1000px;margin:0 auto;padding:24px;">${
  [1, 2, 3, 4].map((i) => `
    <section style="min-height:520px;padding:40px;background:${i % 2 ? '#0d1117' : '#161b22'};color:#e6edf3;border-radius:12px;margin-bottom:16px;">
      <h2 style="font-size:28px;">Section ${i}</h2>
      <p style="font-size:16px;max-width:640px;">A tall test story so the surface spans multiple viewport heights.</p>
    </section>`).join('')
}</div>`;

test('a story renders on the svg surface (the only render path)', async ({ page, request }) => {
  // Create the story via the API (deterministic; the e2e workspace has none seeded).
  const created = await (await request.post('/api/files', {
    data: { name: 'E2E Story', path: '/org/e2e-story', type: 'story', content: { story: TALL_STORY } },
  })).json();
  const id = created?.data?.id as number;
  expect(id).toBeTruthy();

  const container = page.locator(`[data-file-id="${id}"]`);

  await page.goto(`/f/${id}`);
  await expect(page.getByLabel('Story page')).toBeVisible({ timeout: 30_000 });
  await expect(container.locator('iframe')).toHaveCount(1, { timeout: 30_000 });
  // No canvas renderer exists anymore — the surface is live DOM, never a bitmap.
  await expect(container.locator('canvas')).toHaveCount(0);
  // The svg surface: story body inside <svg><foreignObject>, with the content rendered live.
  const frame = page.frameLocator(`[data-file-id="${id}"] iframe`);
  await expect(frame.locator('svg[data-mx-story-svg] foreignObject')).toHaveCount(1, { timeout: 30_000 });
  await expect(frame.locator('svg[data-mx-story-svg]').getByText('Section 4')).toBeVisible();
});
