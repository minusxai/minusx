/**
 * Render→capture readiness handshake for file-view screenshots.
 *
 * After an EditFile, the target view is often mid-rebuild when Screenshot runs: a story remounts
 * its iframe and re-runs every embed query; a question/dashboard shows query spinners. A capture
 * fired after a bare setTimeout(0) rasterizes that half-rebuilt view — the agent then "sees" the
 * old/blank content and gets confused. This waits until the view exists and reports no busy
 * markers for a settle window before the capture.
 *
 * Busy signals (explicit, opt-in): any element with `data-mx-busy="true"` inside the view —
 * including inside same-origin iframes (the story body) — or an iframe whose document is still
 * loading. Components that render a transient loading state mark it with `data-mx-busy` (e.g.
 * QuestionVisualization's query spinner, InlineNumber while its query runs).
 *
 * Best-effort by design: always resolves by `timeoutMs` — a stuck query must degrade to a
 * screenshot of the spinner, never hang the tool.
 */

export interface ReadinessOptions {
  /** Hard cap — always resolve by this deadline. */
  timeoutMs?: number;
  /** How long the view must stay non-busy before we call it settled. */
  settleMs?: number;
  /** Poll interval. */
  pollMs?: number;
}

const BUSY_SELECTOR = '[data-mx-busy="true"]';

function iframeDocs(root: ParentNode): Document[] {
  const docs: Document[] = [];
  for (const iframe of Array.from(root.querySelectorAll('iframe'))) {
    try {
      const doc = (iframe as HTMLIFrameElement).contentDocument;
      if (doc) docs.push(doc);
      else return [];
    } catch {
      // cross-origin iframe — not ours, ignore
    }
  }
  return docs;
}

/** True when the view (or a same-origin iframe within it) shows a busy marker or is still loading. */
export function isFileViewBusy(view: Element): boolean {
  if (view.querySelector(BUSY_SELECTOR)) return true;
  for (const iframe of Array.from(view.querySelectorAll('iframe'))) {
    let doc: Document | null = null;
    try {
      doc = (iframe as HTMLIFrameElement).contentDocument;
    } catch {
      continue; // cross-origin — not ours
    }
    if (!doc) continue;
    if (doc.readyState === 'loading') return true;
    if (doc.querySelector(BUSY_SELECTOR)) return true;
    // one nested level (embeds don't nest iframes today, but stay safe)
    for (const inner of iframeDocs(doc)) {
      if (inner.readyState === 'loading' || inner.querySelector(BUSY_SELECTOR)) return true;
    }
  }
  return false;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Wait until the `[data-file-id]` view exists and has been non-busy for `settleMs`,
 * resolving unconditionally at `timeoutMs`.
 */
export async function waitForFileViewReady(
  fileId: number,
  { timeoutMs = 10000, settleMs = 250, pollMs = 100 }: ReadinessOptions = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let calmSince: number | null = null;
  while (Date.now() < deadline) {
    const view = document.querySelector(`[data-file-id="${fileId}"]`);
    if (!view || isFileViewBusy(view)) {
      calmSince = null;
    } else {
      calmSince = calmSince ?? Date.now();
      if (Date.now() - calmSince >= settleMs) return;
    }
    await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
}
