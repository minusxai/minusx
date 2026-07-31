/**
 * Drag-event bridge for charts rendered inside IFRAME surfaces (stories, dashboards).
 *
 * Vega binds `window:` event sources — the tail of every drag-pan stream, e.g.
 * `[pointerdown, window:pointerup] > window:pointermove` — to the global window of the realm
 * its CODE runs in (vega-view events.js: `sources = [window]`). Story/dashboard charts render
 * into an iframe document through nested React roots, so their drags fire move/up events on
 * the IFRAME window, which never reach Vega's parent-window listeners: element-level click and
 * wheel work, pan is dead. (The question page renders in the main document, so it never sees
 * this.)
 *
 * The bridge re-dispatches the iframe window's move/end events onto the parent window, ONLY
 * between a pointer/mouse/touch-down on the chart's container and the matching end event —
 * synthetic events never leak into parent listeners outside a chart-initiated drag, and
 * coordinates stay consistent because Vega's pan math uses deltas of same-realm
 * (iframe-relative) client coordinates throughout the gesture.
 */

const START_EVENTS = ['pointerdown', 'mousedown', 'touchstart'] as const;
const MOVE_EVENTS = ['pointermove', 'mousemove', 'touchmove'] as const;
const END_EVENTS = ['pointerup', 'pointercancel', 'mouseup', 'touchend', 'touchcancel'] as const;

/**
 * Clone an event for parent-window dispatch, preserving what Vega reads (type + coords +
 * buttons). Detection is by TYPE STRING, never `instanceof`: the source events come from the
 * IFRAME REALM, whose PointerEvent/MouseEvent prototypes are different objects — parent-realm
 * instanceof is always false for them. The cross-realm event works as the init dictionary
 * (members are read via property access), with an explicit-field fallback if a constructor
 * rejects cross-realm values.
 */
function cloneForParent(e: Event): Event | null {
  const src = e as MouseEvent;
  const manualInit: MouseEventInit = {
    clientX: src.clientX, clientY: src.clientY, screenX: src.screenX, screenY: src.screenY,
    button: src.button, buttons: src.buttons,
    ctrlKey: src.ctrlKey, shiftKey: src.shiftKey, altKey: src.altKey, metaKey: src.metaKey,
  };
  if (e.type.startsWith('pointer')) {
    if (typeof PointerEvent === 'undefined') return new MouseEvent(e.type, manualInit);
    try {
      return new PointerEvent(e.type, e as unknown as PointerEventInit);
    } catch {
      return new PointerEvent(e.type, manualInit);
    }
  }
  if (e.type.startsWith('mouse')) {
    try {
      return new MouseEvent(e.type, e as unknown as MouseEventInit);
    } catch {
      return new MouseEvent(e.type, manualInit);
    }
  }
  if (e.type.startsWith('touch') && typeof TouchEvent !== 'undefined') {
    // Touch lists can't be cloned across realms portably — best effort; otherwise drop.
    try {
      return new TouchEvent(e.type, e as unknown as TouchEventInit);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Forward iframe-window drag events (move/up/cancel) to the parent window while a drag that
 * STARTED on `container` is active. No-op when the container lives in the main document.
 * Returns a cleanup that detaches everything (safe to call mid-drag).
 */
export function bridgeIframeDragEvents(container: HTMLElement): () => void {
  const doc = container.ownerDocument;
  const iframeWin = doc?.defaultView;
  if (!doc || !iframeWin || doc === document) return () => {};

  let dragging = false;
  let endGraceUntil = 0;
  let last: { x: number; y: number } | null = null;
  const dispatchClone = (e: Event) => {
    const clone = cloneForParent(e);
    if (clone) window.dispatchEvent(clone);
  };
  const forward = (e: Event) => {
    if (!dragging) return;
    const me = e as MouseEvent;
    if (typeof me.clientX === 'number') last = { x: me.clientX, y: me.clientY };
    dispatchClone(e);
  };
  // End events arrive as FAMILY SIBLINGS: pointerup first, then the compatibility mouseup.
  // Disarming on the first would swallow the sibling — and a Vega MOUSE-stream spec closes its
  // pan gate only on window:mouseup, so a dropped sibling leaves the gate stuck open (the chart
  // then pans on mere hovers). A short grace window forwards the whole sibling burst.
  const END_GRACE_MS = 150;
  const end = (e: Event) => {
    if (dragging) {
      dragging = false;
      endGraceUntil = Date.now() + END_GRACE_MS;
    } else if (Date.now() > endGraceUntil) {
      return;
    }
    dispatchClone(e); // the up/cancel itself must reach Vega to close the stream
  };
  const start = () => {
    dragging = true;
  };
  // Leaving the iframe mid-drag ENDS the gesture (synthesized up at the last known position):
  // outside the story, the parent window's REAL moves reach Vega directly, and without this the
  // pan would keep tracking them — with a coordinate jump — even though the cursor left the chart.
  const endAtBoundary = () => {
    if (!dragging) return;
    dragging = false;
    const init: MouseEventInit = { clientX: last?.x ?? 0, clientY: last?.y ?? 0 };
    if (typeof PointerEvent !== 'undefined') window.dispatchEvent(new PointerEvent('pointerup', init));
    window.dispatchEvent(new MouseEvent('mouseup', init));
  };

  // CAPTURE phase throughout: chart-stack handlers stopPropagation on some of these events
  // mid-path (observed live: iframe-window capture listeners see the drag's mousemoves, bubble
  // listeners never do) — capture at the window fires before any descendant can swallow them.
  START_EVENTS.forEach(t => container.addEventListener(t, start, true));
  MOVE_EVENTS.forEach(t => iframeWin.addEventListener(t, forward, true));
  END_EVENTS.forEach(t => iframeWin.addEventListener(t, end, true));
  doc.documentElement.addEventListener('mouseleave', endAtBoundary);
  return () => {
    dragging = false;
    START_EVENTS.forEach(t => container.removeEventListener(t, start, true));
    MOVE_EVENTS.forEach(t => iframeWin.removeEventListener(t, forward, true));
    END_EVENTS.forEach(t => iframeWin.removeEventListener(t, end, true));
    doc.documentElement.removeEventListener('mouseleave', endAtBoundary);
  };
}
