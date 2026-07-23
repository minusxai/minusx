/**
 * waitForFileViewReady — the render→capture handshake for the Screenshot tool. After an EditFile,
 * the story iframe remounts and embed queries re-run asynchronously; capturing after a bare
 * setTimeout(0) rasterizes the half-rebuilt view (the "agent sees the old story" bug). The wait
 * resolves once the file view exists and has no busy markers for a settle window, and always
 * resolves by the timeout (best-effort — a stuck query must not hang the screenshot).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { waitForFileViewReady } from '../readiness';

function addFileView(fileId: number): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-file-id', String(fileId));
  document.body.appendChild(el);
  return el;
}

describe('waitForFileViewReady', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('resolves quickly when the view exists and nothing is busy, reporting SETTLED', async () => {
    addFileView(1);
    const t0 = Date.now();
    const r = await waitForFileViewReady(1, { timeoutMs: 3000, settleMs: 50, pollMs: 10 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r).toEqual({ settled: true, busyCount: 0 });
  });

  it('waits for a data-mx-busy marker to clear', async () => {
    const view = addFileView(2);
    const busy = document.createElement('div');
    busy.setAttribute('data-mx-busy', 'true');
    view.appendChild(busy);

    setTimeout(() => busy.removeAttribute('data-mx-busy'), 150);
    const t0 = Date.now();
    await waitForFileViewReady(2, { timeoutMs: 3000, settleMs: 50, pollMs: 10 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(140);
  });

  it('waits for the view element itself to appear (post-Navigate capture)', async () => {
    setTimeout(() => addFileView(3), 120);
    const t0 = Date.now();
    await waitForFileViewReady(3, { timeoutMs: 3000, settleMs: 30, pollMs: 10 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(110);
  });

  it('resolves at the timeout even if a busy marker never clears — reporting UNSETTLED with the busy count', async () => {
    // The consumer contract for LLM-facing captures (the staging overcorrection): a timed-out
    // capture shows spinners, and the caller MUST be able to tell the model that.
    const view = addFileView(4);
    for (let i = 0; i < 2; i++) {
      const busy = document.createElement('div');
      busy.setAttribute('data-mx-busy', 'true');
      view.appendChild(busy);
    }

    const t0 = Date.now();
    const r = await waitForFileViewReady(4, { timeoutMs: 300, settleMs: 50, pollMs: 20 });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(280);
    expect(elapsed).toBeLessThan(2000);
    expect(r.settled).toBe(false);
    expect(r.busyCount).toBe(2);
  });

  it('treats a still-loading same-origin iframe as busy', async () => {
    const view = addFileView(5);
    const iframe = document.createElement('iframe');
    view.appendChild(iframe);
    // jsdom iframes get a contentDocument synchronously; simulate "loading" by marking busy inside.
    const doc = iframe.contentDocument!;
    const busy = doc.createElement('div');
    busy.setAttribute('data-mx-busy', 'true');
    doc.body.appendChild(busy);

    setTimeout(() => busy.remove(), 150);
    const t0 = Date.now();
    await waitForFileViewReady(5, { timeoutMs: 3000, settleMs: 50, pollMs: 10 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(140);
  });
});
