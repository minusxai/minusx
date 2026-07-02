/**
 * Document-wide reorder-in-flow move for story widgets. Stories are a flow document (no x/y canvas), so
 * "move" means changing a widget's position in the flow — but NOT limited to its immediate parent (that
 * only lets a chart shuffle past its own caption). Instead:
 *
 *  - `movableUnit` finds the whole CARD to move: it climbs from the embed placeholder to the outermost
 *    tight wrapper that groups ONLY this chart with its caption/label chrome (no prose, no second embed),
 *    so a drag carries the card rather than orphaning the caption.
 *  - `collectDropSlots` enumerates every flow gap across the WHOLE document, recursing through nested
 *    flow containers — but never into a packed grid/flex/table (dropping a widget there would give it a
 *    packed ancestor and silently re-break px resize) and never into the dragged unit, another embed, or
 *    a number callout.
 *  - `chooseDropSlot` maps the pointer Y to the nearest gap (preferring the shallower container on a tie,
 *    so drops read as high-level and predictable).
 *  - `applyDrop` splices the card into that gap. serialize-story clones child nodes in DOM order, so the
 *    new position persists with no extra bookkeeping.
 */
import { isPackedDisplay } from './story-widget-layout';

/** Elements that are NOT reorder targets: AgentHtml scaffolding + our own drag chrome. */
const NON_MOVABLE = 'style, [data-mx-embed-root], [data-mx-drop-indicator]';
/** Narrative prose — its presence marks a wrapper as a section (not a tight single-chart card). */
const PROSE = 'p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote';
/** Chart embeds (for the single-card test in `movableUnit`). */
const CHART_EMBED = '[data-question-id], [data-question-inline]';
/** Any embed/callout we must never recurse INTO when hunting for drop gaps. */
const LEAF_EMBED = '[data-question-id], [data-question-inline], [data-number-inline]';

type StyleReader = (el: Element) => CSSStyleDeclaration;
type Rect = { top: number; bottom: number; left: number; width: number };
type RectReader = (el: Element) => Rect;

const defaultStyleReader: StyleReader = (el) =>
  (el.ownerDocument.defaultView ?? window).getComputedStyle(el);
const defaultRectReader: RectReader = (el) => {
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, width: r.width };
};

/** A widget lays its children out in normal flow (their own `width` governs) — a valid drop container. */
function isFlow(el: Element, getStyle: StyleReader): boolean {
  return !isPackedDisplay(getStyle(el).display);
}

/**
 * The story's own root — the reorder canvas. AgentHtml writes the whole story into a single element under
 * the iframe `<body>`, but `<body>` ALSO holds portaled popovers, the embed root, and shim styles; walking
 * from `<body>` would offer drop slots next to that scaffolding. So the canvas is the topmost ancestor of
 * `el` that is still a direct child of `<body>` (the story root), never `<body>` itself.
 */
export function storyCanvas(el: HTMLElement): HTMLElement {
  const body = el.ownerDocument.body;
  let node = el;
  while (node.parentElement && node.parentElement !== body) node = node.parentElement;
  return node;
}

/** A drop position: splice `unit` into `container` before `before` (null → append). `y` is the gap's
 *  viewport Y; `depth` is the container's nesting under the canvas (for the nearest-gap tie-break). */
export interface DropSlot {
  container: HTMLElement;
  before: HTMLElement | null;
  y: number;
  depth: number;
}

/**
 * The whole card to move for `embed`: climb to the outermost tight wrapper that groups only this one
 * chart with its caption/label (no prose, no second embed), staying in flow and below the canvas. Returns
 * the bare embed when it has no such wrapper (a chart sitting directly in a flow container).
 */
export function movableUnit(embed: HTMLElement, canvas: HTMLElement, getStyle: StyleReader = defaultStyleReader): HTMLElement {
  let unit = embed;
  for (let p = embed.parentElement; p && p !== canvas && isFlow(p, getStyle); p = p.parentElement) {
    if (p.querySelectorAll(CHART_EMBED).length !== 1) break; // wraps another chart too → not one card
    if (p.querySelector(PROSE)) break;                       // holds narrative prose → a section, not a card
    unit = p;
  }
  return unit;
}

/**
 * Every flow gap `unit` could be dropped into across the whole document rooted at `canvas`. Recurses
 * through nested flow containers but never into a packed container, an embed/callout, or the dragged unit
 * itself. `getStyle`/`getRect` are injectable for tests; default to computed style / getBoundingClientRect.
 */
export function collectDropSlots(
  canvas: HTMLElement,
  unit: HTMLElement,
  getStyle: StyleReader = defaultStyleReader,
  getRect: RectReader = defaultRectReader,
): DropSlot[] {
  const slots: DropSlot[] = [];

  const walk = (container: HTMLElement, depth: number) => {
    const kids = (Array.from(container.children) as HTMLElement[]).filter(el => !el.matches(NON_MOVABLE));
    let lastGapRef: HTMLElement | null = null;
    for (const child of kids) {
      if (child === unit || unit.contains(child)) continue; // never a gap at, or inside, the dragged unit
      slots.push({ container, before: child, y: getRect(child).top, depth });
      lastGapRef = child;
      // Descend only into real flow containers with children — not packed cells, embeds, or leaves.
      if (child.children.length > 0 && !child.matches(LEAF_EMBED) && isFlow(child, getStyle)) {
        walk(child, depth + 1);
      }
    }
    // Trailing "append" gap: below the last usable child, else the container's own bottom.
    slots.push({ container, before: null, y: (lastGapRef ? getRect(lastGapRef).bottom : getRect(container).bottom), depth });
  };

  walk(canvas, 0);
  return slots;
}

/**
 * The gap nearest `pointerY`. On a near-tie in distance, prefers the shallower container (a higher-level,
 * more predictable drop). Returns null for an empty list.
 */
export function chooseDropSlot(slots: DropSlot[], pointerY: number): DropSlot | null {
  let best: DropSlot | null = null;
  let bestScore = Infinity;
  for (const s of slots) {
    const score = Math.round(Math.abs(s.y - pointerY)) * 1000 + s.depth; // distance dominates; depth breaks ties
    if (score < bestScore) { bestScore = score; best = s; }
  }
  return best;
}

/** Splice `unit` into `slot.container` before `slot.before` (null → append) in the real DOM. */
export function applyDrop(unit: HTMLElement, slot: DropSlot): void {
  slot.container.insertBefore(unit, slot.before);
}

/**
 * Draw the live insertion indicator — a fixed-position line at `slot.y` spanning the reference block's
 * width. Viewport (fixed) coords so it needs no positioned ancestor. Imperative DOM glue for
 * StoryMoveHandle; kept here so the component never mutates its props (react-hooks/immutability).
 */
export function positionDropIndicator(canvas: HTMLElement, slot: DropSlot, getRect: RectReader = defaultRectReader): void {
  const doc = canvas.ownerDocument;
  let bar = doc.querySelector<HTMLElement>('[data-mx-drop-indicator]');
  if (!bar) {
    bar = doc.createElement('div');
    bar.setAttribute('data-mx-drop-indicator', '');
    doc.body.appendChild(bar);
  }
  const r = getRect(slot.before ?? slot.container);
  Object.assign(bar.style, {
    position: 'fixed',
    left: `${r.left}px`,
    width: `${Math.max(r.width, 40)}px`,
    top: `${slot.y - 1.5}px`,
    height: '3px',
    background: 'var(--mx-accent, #3b82f6)',
    borderRadius: '2px',
    zIndex: '40',
    pointerEvents: 'none',
  });
}

/** Remove the insertion indicator from `doc`, if present. */
export function removeDropIndicator(doc: Document): void {
  doc.querySelector('[data-mx-drop-indicator]')?.remove();
}
