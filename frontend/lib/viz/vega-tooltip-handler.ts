/**
 * A document-aware version of vega-tooltip's cursor handler.
 *
 * VegaChart can render in the top document or in a same-origin dashboard/story iframe.
 * The upstream handler closes over the JavaScript realm's global `document`/`window`,
 * so an iframe pointer's client coordinates were applied to a tooltip in the top
 * document. Keeping the tooltip in the chart container's ownerDocument makes the
 * event coordinates, fixed positioning, and viewport collision checks agree.
 */
import { escapeHTML, formatValue } from 'vega-tooltip';
import { ensureTooltipStyles } from './tooltip-styles';

const TOOLTIP_ID = 'vg-tooltip-element';
const OFFSET = 10;

type VegaTooltipHandler = (handler: unknown, event: MouseEvent, item: unknown, value: unknown) => void;

function getTooltipElement(doc: Document): HTMLElement {
  ensureTooltipStyles(doc);
  let el = doc.getElementById(TOOLTIP_ID);
  if (!el) {
    el = doc.createElement('div');
    el.id = TOOLTIP_ID;
    (doc.fullscreenElement ?? doc.body).appendChild(el);
  }

  // These structural styles normally come from vega-tooltip's injected stylesheet.
  // Set them inline because that stylesheet is also installed in the wrong document.
  el.style.position = 'fixed';
  el.style.zIndex = '1000';
  el.style.pointerEvents = 'none';
  el.style.whiteSpace = 'pre-line';
  return el;
}

/** Create a Vega tooltip callback scoped to the rendered chart's document. */
export function createVegaTooltipHandler(
  container: HTMLElement,
  theme: 'light' | 'dark',
): VegaTooltipHandler {
  const doc = container.ownerDocument;

  return (_handler, event, _item, value) => {
    const el = getTooltipElement(doc);
    if (value == null || value === '') {
      el.className = 'vg-tooltip';
      el.style.visibility = 'hidden';
      return;
    }

    el.innerHTML = formatValue(value, escapeHTML, 2, doc.baseURI);
    el.className = `vg-tooltip visible ${theme}-theme`;
    el.style.visibility = 'visible';

    const viewport = doc.defaultView;
    const box = el.getBoundingClientRect();
    let x = event.clientX + OFFSET;
    let y = event.clientY + OFFSET;
    if (viewport && x + box.width > viewport.innerWidth) x = event.clientX - box.width - OFFSET;
    if (viewport && y + box.height > viewport.innerHeight) y = event.clientY - box.height - OFFSET;
    el.style.left = `${Math.max(0, x)}px`;
    el.style.top = `${Math.max(0, y)}px`;
  };
}
