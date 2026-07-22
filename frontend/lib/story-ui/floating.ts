/**
 * Story floating-element CSS.
 *
 * Stories render inside <svg><foreignObject>, where `position: fixed` is broken
 * (fixed positioning resolves against the nearest SVG viewport, not the page,
 * so Radix's viewport-relative coordinates land in the wrong place entirely).
 *
 * The vendored tooltip/popover components therefore render WITHOUT a Portal
 * (content stays inline inside the story root), but Radix's Popper still wraps
 * the content in an internal `[data-radix-popper-content-wrapper]` div that it
 * styles with `position: fixed`. There is no `strategy` prop on the Radix
 * Content components to change this, so the story stylesheet must force the
 * wrapper to absolute positioning instead. Inject this CSS into the story root.
 *
 * Collision handling: `collisionBoundary` is left at its Radix default in the
 * vendored components; the mounting code should pass the story root element as
 * the collision boundary (via TooltipContent/PopoverContent props) where
 * possible so floating content stays inside the story bounds.
 */
export const STORY_FLOATING_CSS = `
[data-radix-popper-content-wrapper] {
  position: absolute !important;
}
`;
