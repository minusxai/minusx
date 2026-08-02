/**
 * Console/page-error guard for the QA flows.
 *
 * The QA specs assert on Redux and the DOM, so a page that throws in the console
 * while still rendering the elements a flow clicks passes silently. A React
 * hydration mismatch on the tutorial home page went unnoticed exactly that way:
 * every flow passed, the error was only visible with devtools open.
 *
 * This collects `console.error` and uncaught `pageerror` events and fails the
 * test at the end, minus an explicit allowlist. The allowlist is the point — a
 * bare gate would go red on known pre-existing noise and get disabled.
 *
 * Adding an entry requires a reason. Removing one is how a fix gets locked in.
 */
import { type Page, expect } from '@playwright/test';

interface Allowance {
  /** Matches the message text, or a classifier over it. */
  match: (msg: string) => boolean;
  /** Why this is tolerated, and what would let it be deleted. */
  why: string;
}

const ALLOWED: Allowance[] = [
  // The hydration allowance that used to live here is GONE, which is the point of this list.
  // Both causes are fixed: `components/ui/Link.tsx` now reads `useSearchParams()` instead of
  // `window.location` (so server and client build the same href), and `app/p/[[...path]]/page.tsx`
  // picks its sidebar through `useSyncExternalStore`, whose server snapshot React reuses during
  // hydration. Neither objection recorded in the old entry survived: `useSearchParams` carries
  // `as_user` along with everything else, and the dynamic-rendering bailout costs nothing here —
  // a production build renders all 136 routes dynamically already, with no static route to lose.
  // A hydration error reaching this gate again is a regression, not known noise.
  {
    // Playwright navigates away mid-flight constantly; the browser cancels the
    // in-flight fetch and Next/our fetch-patch logs it. Not a product fault.
    match: (m) =>
      /net::ERR_ABORTED|AbortError|The user aborted a request|signal is aborted/i.test(m) ||
      /Failed to fetch/i.test(m),
    why: 'Request cancelled by a navigation the test itself triggered — not a product error.',
  },
  {
    // React DevTools / extension chatter and the Next.js dev overlay download hint.
    match: (m) => /Download the React DevTools|react-devtools/i.test(m),
    why: 'Browser/tooling advisory, not application output.',
  },
];

function isAllowed(message: string): boolean {
  return ALLOWED.some((a) => a.match(message));
}

/**
 * Start collecting console errors on `page`. Returns an assert function; call it
 * at the end of the flow (or let `test/qa/flows.ts`'s fixture do it for you).
 *
 * Collect-then-assert rather than fail-fast: a flow that is going to fail on its
 * own assertion should report THAT, not a console line that happened first.
 */
export function installConsoleGuard(page: Page): () => void {
  const violations: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (!isAllowed(text)) violations.push(`console.error: ${text}`);
  });

  page.on('pageerror', (err) => {
    const text = err.message || String(err);
    if (!isAllowed(text)) violations.push(`pageerror: ${text}`);
  });

  return () => {
    expect(
      violations,
      `Unexpected browser console errors during this flow. If one is known-benign, add it to ` +
        `ALLOWED in test/qa/console-guard.ts WITH a reason:\n  - ${violations.join('\n  - ')}`,
    ).toEqual([]);
  };
}
