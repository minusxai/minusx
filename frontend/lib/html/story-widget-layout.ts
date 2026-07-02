/**
 * Flow-block layout contract for resizable/movable story widgets.
 *
 * Free px resize on BOTH axes (and reorder-in-flow move) only works when a widget is a plain flow
 * block: no ancestor between it and the story canvas may size it via a track/cell. In a grid/flex/table
 * the element's own `width` is subordinate to the column/track (an authored px width overflows its cell
 * or is shrunk), so horizontal resize silently no-ops — exactly the bug this contract prevents. The
 * widget carries a resizable width (an explicit px value, or `100%` for a responsive full-width default)
 * and an explicit px height, so a drag produces a real, serializable size.
 *
 * `findWidgetLayoutViolations` walks a widget's ancestors (up to, not past, the canvas) over computed
 * `display` and reports every violation. The render layer can warn/repair; tests assert the contract.
 */
import { immutableSet } from '@/lib/utils/immutable-collections';

export type WidgetLayoutViolation =
  | { kind: 'packed-ancestor'; display: string; tag: string }
  | { kind: 'non-px-width'; value: string }
  | { kind: 'non-px-height'; value: string };

/** display values whose children are sized by a track/cell rather than their own `width`. */
const PACKED_DISPLAYS = immutableSet([
  'grid', 'inline-grid', 'flex', 'inline-flex',
  'table', 'inline-table', 'table-row', 'table-cell',
]);

/**
 * True when `display` lays children out via a track/cell (grid/flex/table) rather than normal flow — so
 * a child's own `width` is subordinate and free px resize silently no-ops. The move logic reuses this to
 * refuse drop targets inside a packed container (which would re-break the widget's resize contract).
 */
export function isPackedDisplay(display: string): boolean {
  return PACKED_DISPLAYS.has(display);
}

const isPx = (v: string): boolean => /^-?\d*\.?\d+px$/.test(v.trim());
/** A valid flow-block width: an explicit px value, or `100%` (responsive full-width default). Both
 *  render predictably and stay freely user-resizable (the handle reads offsetWidth → px). */
const isValidWidth = (v: string): boolean => isPx(v) || v.trim() === '100%';

type StyleReader = (el: Element) => CSSStyleDeclaration;

const defaultStyleReader: StyleReader = (el) =>
  (el.ownerDocument.defaultView ?? window).getComputedStyle(el);

/**
 * Every reason `widget` can't be freely px-resized/reordered as a flow block within `canvas`.
 * Empty array ⇒ compliant. `getStyle` is injectable for tests; defaults to computed style.
 */
export function findWidgetLayoutViolations(
  widget: HTMLElement,
  canvas: HTMLElement,
  getStyle: StyleReader = defaultStyleReader,
): WidgetLayoutViolation[] {
  const violations: WidgetLayoutViolation[] = [];

  // 1) No grid/flex/table ancestor between the widget and the canvas.
  for (let node = widget.parentElement; node && node !== canvas; node = node.parentElement) {
    const display = getStyle(node).display;
    if (isPackedDisplay(display)) {
      violations.push({ kind: 'packed-ancestor', display, tag: node.tagName.toLowerCase() });
    }
  }

  // 2) The widget must carry a resizable width (px or 100%) and an explicit px height.
  const w = widget.style.width;
  const h = widget.style.height;
  if (!isValidWidth(w)) violations.push({ kind: 'non-px-width', value: w });
  if (!isPx(h)) violations.push({ kind: 'non-px-height', value: h });

  return violations;
}
