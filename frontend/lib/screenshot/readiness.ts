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
 * QuestionVisualization's query spinner, InlineNumber while its query runs), and AgentHtml stamps
 * every emptied embed placeholder at discovery (cleared by StoryEmbeds once the embed mounts) so
 * the pre-hydration blank boxes after a story remount are never captured as "settled".
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

/**
 * What the wait actually observed — consumers that feed the capture to an LLM (agent review,
 * app-state image) MUST branch on `settled`: a timed-out capture shows spinners/blank embeds,
 * and a model that isn't told will read them as broken content and "fix" them (the staging
 * overcorrection: the agent deleted healthy embeds because its review image caught them
 * mid-load).
 */
export interface FileViewReadiness {
  /** True when a calm settle window was observed; false when the wait hit its timeout. */
  settled: boolean;
  /** Busy markers still present at the final check (0 when settled). */
  busyCount: number;
}

const BUSY_SELECTOR = '[data-mx-busy="true"]';

/**
 * Windowed-tile force-mount request (Renderer_v2 Phase 7). Dashboards window their question
 * tiles: off-viewport tiles are BUSY layout ghosts. A capture must never serialize ghosts, so the
 * readiness wait broadcasts this event — every ghost mounts its real tile, whose own busy markers
 * then gate the settle. Dispatched on `document`; ghosts listen there.
 */
export const FORCE_MOUNT_TILES_EVENT = 'mx-force-mount-tiles';

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

/** Busy markers in the view (or its same-origin iframes) — 0 means calm. A still-loading iframe
 *  document counts as one marker (its content can't be inspected yet). */
function fileViewBusyCount(view: Element): number {
  let count = view.querySelectorAll(BUSY_SELECTOR).length;
  for (const iframe of Array.from(view.querySelectorAll('iframe'))) {
    let doc: Document | null = null;
    try {
      doc = (iframe as HTMLIFrameElement).contentDocument;
    } catch {
      continue; // cross-origin — not ours
    }
    if (!doc) continue;
    if (doc.readyState === 'loading') count += 1;
    count += doc.querySelectorAll(BUSY_SELECTOR).length;
    // one nested level (embeds don't nest iframes today, but stay safe)
    for (const inner of iframeDocs(doc)) {
      if (inner.readyState === 'loading') count += 1;
      count += inner.querySelectorAll(BUSY_SELECTOR).length;
    }
  }
  return count;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Wait until the `[data-file-id]` view exists and has been non-busy for `settleMs`,
 * resolving unconditionally at `timeoutMs` — the RESULT says which of the two happened
 * (see FileViewReadiness; LLM-facing captures must surface an unsettled result).
 */
export async function waitForFileViewReady(
  fileId: number,
  { timeoutMs = 10000, settleMs = 250, pollMs = 100 }: ReadinessOptions = {},
): Promise<FileViewReadiness> {
  const deadline = Date.now() + timeoutMs;
  let calmSince: number | null = null;
  let lastBusy = 0;
  while (Date.now() < deadline) {
    // Re-broadcast every poll (cheap no-op when nothing is windowed): the view can REMOUNT while
    // settling (EditFile rebuild), and freshly remounted ghosts must also be force-mounted.
    document.dispatchEvent(new CustomEvent(FORCE_MOUNT_TILES_EVENT));
    const view = document.querySelector(`[data-file-id="${fileId}"]`);
    lastBusy = view ? fileViewBusyCount(view) : 1;
    if (!view || lastBusy > 0) {
      calmSince = null;
    } else {
      calmSince = calmSince ?? Date.now();
      if (Date.now() - calmSince >= settleMs) return { settled: true, busyCount: 0 };
    }
    await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
  return { settled: false, busyCount: Math.max(lastBusy, 1) };
}
