/**
 * Playwright DOM-driver flow helpers (Tests/QA/Evals Arch V2 — Phase 4).
 *
 * Mirror the node helpers' vocabulary (`test/flows/node.ts`) name-for-name; the
 * difference is the bottom verb: click/type instead of dispatch, and reading
 * state via `window.__MX_STORE__.getState()` instead of `store.getState()`.
 */
import { expect, type Page } from '@playwright/test';

/**
 * Read the exposed Redux state (the e2e gate puts the store on window).
 * Null-safe: returns null before the store is exposed so pollers retry cleanly
 * instead of throwing on `undefined.getState()`.
 */
export async function getState<T = unknown>(page: Page): Promise<T> {
  try {
    return await page.evaluate(() => {
      const store = (window as unknown as { __MX_STORE__?: { getState(): unknown } }).__MX_STORE__;
      return (store?.getState() ?? null) as unknown;
    }) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Execution context was destroyed')) {
      return null as T;
    }
    throw error;
  }
}

/** Poll the Redux state until `predicate` holds (or time out). */
export async function assertRedux(
  page: Page,
  predicate: (state: any) => boolean,
  opts: { timeout?: number; message?: string } = {},
): Promise<void> {
  await expect
    .poll(async () => predicate(await getState(page)), {
      timeout: opts.timeout ?? 30_000,
      message: opts.message ?? 'Redux state never satisfied the predicate',
    })
    .toBe(true);
}

/** Click a control located by its aria-label. */
export async function clickByLabel(page: Page, label: string): Promise<void> {
  await page.getByLabel(label).click();
}

/**
 * Type a message into the side chat input and send it.
 * The composable building block from the design (`...enterSideChatMessage(msg)`).
 */
export async function enterSideChatMessage(page: Page, message: string): Promise<void> {
  const input = page.getByLabel('Chat message input');
  await input.click();
  await input.fill(message);
  await page.getByLabel('Send message').click();
}
