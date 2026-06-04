/**
 * Runtime E2E opt-in (Tests/QA/Evals Arch V2 — Phase 5 enabler).
 *
 * Lets a QA session opt into E2E affordances (exposing `window.__MX_STORE__`) on
 * a normal production build via `?e2e=<E2E_RUNTIME_SECRET>`, without baking the
 * build-time `E2E_MODE` flag into what real users get.
 *
 * The middleware validates the param/cookie here and stamps the `x-e2e-enabled`
 * request header; SSR reads that header and tells `ReduxProvider` to expose the
 * store. The secret is a **hygiene gate only** — exposing the store reveals just
 * the current session's own Redux state (already in the user's browser), not any
 * other user's data. If the secret leaks, rotate it; nothing user-facing is at risk.
 *
 * Server-only (reads the secret from config). Off by default: unset secret ⇒ disabled.
 */
import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { E2E_RUNTIME_SECRET } from '@/lib/config';

export const E2E_PARAM = 'e2e';
export const E2E_COOKIE = 'mx_e2e';
export const E2E_HEADER = 'x-e2e-enabled';

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** True iff `value` matches the configured runtime secret (and a secret is set). */
export function matchesE2ESecret(value: string | null | undefined): boolean {
  if (!E2E_RUNTIME_SECRET || !value) return false;
  return constantTimeEqual(value, E2E_RUNTIME_SECRET);
}
