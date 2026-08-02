/**
 * Edit-mode structural CSS for the story `<Grid>` — a hand-vendored subset of
 * react-grid-layout/css/styles.css (v1.5.2), injected INSIDE the story surface root by the
 * edit-mode Grid adapter (never `<head>`: head styles are lost by the SVG capture path, and
 * the top document's stylesheets never reach the iframe realm at all).
 *
 * Two deliberate deviations from the library stylesheet:
 *  - ALL `.react-grid-item` transitions are killed. Chromium does not repaint transformed
 *    `foreignObject` content mid-transition — items would freeze between positions (the
 *    dashboard's stale-tiles bug; DashboardView injects the same rule).
 *  - Only the south-east resize handle rules are carried (the adapter enables only `se`).
 *
 * View mode needs none of this: the pure-CSS Grid positions via compiled Tailwind classes.
 */
export const STORY_GRID_EDIT_CSS = `
.react-grid-layout { position: relative; }
.react-grid-item { transition: none !important; }
.react-grid-item img { pointer-events: none; user-select: none; }
.react-grid-item a { -webkit-user-drag: none; }
.react-grid-item.resizing { z-index: 1; will-change: width, height; }
.react-grid-item.react-draggable-dragging { z-index: 3; will-change: transform; cursor: grabbing; }
.react-grid-item.react-grid-placeholder {
  background: var(--primary, #14b8a6);
  opacity: 0.15;
  border-radius: 6px;
  z-index: 2;
  user-select: none;
}
.react-grid-item > .react-resizable-handle {
  position: absolute;
  width: 20px;
  height: 20px;
}
.react-grid-item > .react-resizable-handle::after {
  content: "";
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 5px;
  height: 5px;
  border-right: 2px solid rgba(127, 127, 127, 0.6);
  border-bottom: 2px solid rgba(127, 127, 127, 0.6);
}
.react-grid-item > .react-resizable-handle.react-resizable-handle-se {
  bottom: 0;
  right: 0;
  cursor: se-resize;
}
`;
