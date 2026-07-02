/**
 * Reorder-in-flow move for story widgets. Stories are a flow document (no x/y canvas), so "move" means
 * changing a widget's position among its flow siblings. The dragged block follows the pointer; on drop
 * it's spliced into the slot the pointer indicates. serialize-story clones child nodes in DOM order, so
 * the new order persists with no extra bookkeeping.
 */
export interface BlockRect {
  top: number;
  bottom: number;
}

/** Selector for elements that are NOT reorder targets (AgentHtml scaffolding / our own chrome). */
const NON_MOVABLE = 'style, [data-mx-embed-root], [data-mx-drop-indicator]';

/**
 * The flow siblings among which `widget` can be reordered: its parent's element children minus
 * injected scaffolding (style tags, the embed root, the drop indicator). Includes `widget` itself, so
 * the result is the ordered list `reorderBlock` expects. Empty when the widget has no parent.
 */
export function movableSiblings(widget: HTMLElement): HTMLElement[] {
  const parent = widget.parentElement;
  if (!parent) return [];
  return (Array.from(parent.children) as HTMLElement[]).filter(el => !el.matches(NON_MOVABLE));
}

/**
 * Insertion slot (0..n) for a pointer at `pointerY` over vertically-stacked `rects`: the number of
 * blocks whose vertical midpoint is above the pointer. Blocks are assumed top-to-bottom ordered.
 */
export function computeDropIndex(rects: BlockRect[], pointerY: number): number {
  return rects.filter(r => pointerY > (r.top + r.bottom) / 2).length;
}

/**
 * Draw the live insertion indicator — a fixed-position line at the top of `others[index]` (or the
 * bottom of the last block when dropping at the end) spanning that block's width. `others` is the
 * sibling list WITHOUT the dragged widget, so `index` maps straight to the drop slot. Uses viewport
 * (fixed) coordinates so it needs no positioned ancestor. Imperative DOM glue for StoryMoveHandle;
 * kept out of the component so the component never mutates its props (react-hooks/immutability).
 */
export function positionDropIndicator(widget: HTMLElement, others: HTMLElement[], index: number): void {
  const doc = widget.ownerDocument;
  let bar = doc.querySelector<HTMLElement>('[data-mx-drop-indicator]');
  if (!bar) {
    bar = doc.createElement('div');
    bar.setAttribute('data-mx-drop-indicator', '');
    doc.body.appendChild(bar);
  }
  const atEnd = index >= others.length;
  const ref = atEnd ? others[others.length - 1] : others[index];
  if (!ref) { bar.remove(); return; }
  const r = ref.getBoundingClientRect();
  Object.assign(bar.style, {
    position: 'fixed',
    left: `${r.left}px`,
    width: `${r.width}px`,
    top: `${(atEnd ? r.bottom : r.top) - 1.5}px`,
    height: '3px',
    background: 'var(--mx-accent, #3b82f6)',
    borderRadius: '2px',
    zIndex: '40',
    pointerEvents: 'none',
  });
}

/** Remove the insertion indicator, if present. */
export function removeDropIndicator(widget: HTMLElement): void {
  widget.ownerDocument.querySelector('[data-mx-drop-indicator]')?.remove();
}

/**
 * Move `node` to `index` within `orderedSiblings` (which includes `node`) in the real DOM. Returns the
 * clamped final index. Idempotent when `index` is the node's current slot. Siblings are assumed to share
 * a parent (the flow container).
 */
export function reorderBlock(node: HTMLElement, orderedSiblings: HTMLElement[], index: number): number {
  const others = orderedSiblings.filter(el => el !== node);
  const clamped = Math.max(0, Math.min(index, others.length));
  const ref = others[clamped] ?? null; // insert before this sibling; null → append at end
  node.parentNode?.insertBefore(node, ref);
  return clamped;
}
