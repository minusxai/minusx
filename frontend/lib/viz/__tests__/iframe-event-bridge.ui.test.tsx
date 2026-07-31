/**
 * bridgeIframeDragEvents — Vega drag-pan inside iframe surfaces (stories, dashboards).
 *
 * Vega binds `window:` event sources to ITS realm's global window (vega-view events.js), but
 * story/dashboard charts render into an IFRAME document via nested React roots — so during a
 * drag, pointermove/up fire on the iframe window and Vega's parent-window listeners never see
 * them (pan dead; element-level click/wheel unaffected). The bridge re-dispatches the iframe
 * window's move/up events onto the parent window, ONLY while a drag that started on the
 * chart's container is active — synthetic events never leak outside chart drags.
 */
import { bridgeIframeDragEvents } from '@/lib/viz/iframe-event-bridge';

function setupIframeContainer() {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const idoc = iframe.contentDocument!;
  const container = idoc.createElement('div');
  idoc.body.appendChild(container);
  return { iframe, idoc, iwin: iframe.contentWindow!, container };
}

afterEach(() => {
  document.querySelectorAll('iframe').forEach(f => f.remove());
});

describe('bridgeIframeDragEvents', () => {
  it('no-ops for containers in the main document', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const seen = vi.fn();
    window.addEventListener('mousemove', seen);
    const cleanup = bridgeIframeDragEvents(container);
    container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    container.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5 }));
    // The native event bubbles to window once; the bridge must not RE-dispatch (no doubling).
    expect(seen).toHaveBeenCalledTimes(1);
    cleanup();
    window.removeEventListener('mousemove', seen);
    container.remove();
  });

  it('forwards iframe move/up to the parent window only while a chart drag is active', () => {
    const { iwin, container } = setupIframeContainer();
    const moves: number[] = [];
    const ups = vi.fn();
    const onMove = (e: Event) => moves.push((e as MouseEvent).clientX);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', ups);
    const cleanup = bridgeIframeDragEvents(container);

    // Before any drag: iframe moves are NOT forwarded.
    iwin.dispatchEvent(new MouseEvent('mousemove', { clientX: 1 }));
    expect(moves).toEqual([]);

    // Drag starts on the container → subsequent iframe-window moves forward with coordinates.
    container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 20 }));
    iwin.dispatchEvent(new MouseEvent('mousemove', { clientX: 15, clientY: 25 }));
    iwin.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 40 }));
    expect(moves).toEqual([15, 30]);

    // mouseup forwards AND ends the drag: nothing forwards after it.
    iwin.dispatchEvent(new MouseEvent('mouseup', { clientX: 30 }));
    expect(ups).toHaveBeenCalledTimes(1);
    iwin.dispatchEvent(new MouseEvent('mousemove', { clientX: 99 }));
    expect(moves).toEqual([15, 30]);

    cleanup();
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', ups);
  });

  it('forwards by TYPE, not instanceof — iframe-realm events must not be dropped', () => {
    // Real iframe events carry the IFRAME realm's prototypes; parent-realm instanceof is
    // always false for them. A bare Event with a mouse type simulates the realm mismatch.
    const { iwin, container } = setupIframeContainer();
    const moves = vi.fn();
    window.addEventListener('mousemove', moves);
    const cleanup = bridgeIframeDragEvents(container);
    container.dispatchEvent(new Event('mousedown', { bubbles: true }));
    iwin.dispatchEvent(new Event('mousemove'));
    expect(moves).toHaveBeenCalledTimes(1);
    cleanup();
    window.removeEventListener('mousemove', moves);
  });

  it('forwards BOTH end-family siblings — pointerup then compat mouseup (the stuck-gate bug)', () => {
    // Browsers fire pointerup first, then the compatibility mouseup. Vega mouse-stream specs
    // close their pan gate ONLY on window:mouseup — dropping the sibling leaves the gate stuck
    // open and the chart pans on mere hovers ever after.
    const { iwin, container } = setupIframeContainer();
    const pointerUps = vi.fn();
    const mouseUps = vi.fn();
    window.addEventListener('pointerup', pointerUps);
    window.addEventListener('mouseup', mouseUps);
    const cleanup = bridgeIframeDragEvents(container);
    container.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    container.dispatchEvent(new Event('mousedown', { bubbles: true }));
    iwin.dispatchEvent(new Event('pointerup'));
    iwin.dispatchEvent(new Event('mouseup'));
    expect(pointerUps).toHaveBeenCalledTimes(1);
    expect(mouseUps).toHaveBeenCalledTimes(1);
    cleanup();
    window.removeEventListener('pointerup', pointerUps);
    window.removeEventListener('mouseup', mouseUps);
  });

  it('ends the drag at the iframe boundary — leaving the story must stop the pan', () => {
    const { idoc, iwin, container } = setupIframeContainer();
    const ups = vi.fn();
    const moves = vi.fn();
    window.addEventListener('mouseup', ups);
    window.addEventListener('mousemove', moves);
    const cleanup = bridgeIframeDragEvents(container);
    container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    iwin.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 60 }));
    expect(moves).toHaveBeenCalledTimes(1);
    // Cursor exits the iframe mid-drag → synthesized mouseup at the last known position ends
    // the gesture; the parent's REAL moves outside must find the gate closed.
    idoc.documentElement.dispatchEvent(new MouseEvent('mouseleave'));
    expect(ups).toHaveBeenCalledTimes(1);
    expect((ups.mock.calls[0][0] as MouseEvent).clientX).toBe(50);
    iwin.dispatchEvent(new MouseEvent('mousemove', { clientX: 99 }));
    expect(moves).toHaveBeenCalledTimes(1); // no longer forwarding
    cleanup();
    window.removeEventListener('mouseup', ups);
    window.removeEventListener('mousemove', moves);
  });

  it('cleanup detaches everything, even mid-drag', () => {
    const { iwin, container } = setupIframeContainer();
    const moves = vi.fn();
    window.addEventListener('mousemove', moves);
    const cleanup = bridgeIframeDragEvents(container);
    container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    cleanup();
    iwin.dispatchEvent(new MouseEvent('mousemove', { clientX: 5 }));
    expect(moves).not.toHaveBeenCalled();
    window.removeEventListener('mousemove', moves);
  });
});
