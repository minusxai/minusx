/**
 * View type definitions for chrome-level rendering isolation.
 *
 * `view` is a top-level URL param (like `mode`) that is preserved across links.
 * It is an ORDERED enum — each level strips strictly more app chrome than the one
 * before it, so consumers use threshold checks (`viewAtLeast`) rather than
 * equality. Default is 'full' (level 0): normal app, no chrome removed.
 *
 *   level 0  full         — normal app: left sidebar, top bar, file header, right sidebar
 *   level 1  file         — hide left sidebar + top bar (breadcrumb)
 *   level 2  content      — also hide the file header (title + save/publish actions)
 *   level 3  contentonly  — also hide the right (chat/context) sidebar
 *
 * For embedding a bare file / folder / chat in an iframe.
 */

// Ordered from least to most chrome-stripping; array index == level.
export const VIEW_ORDER = ['full', 'file', 'content', 'contentonly'] as const;

export type View = (typeof VIEW_ORDER)[number];

export const DEFAULT_VIEW: View = 'full';

/** Check if a string is a valid view. */
export function isValidView(view: string): view is View {
  return (VIEW_ORDER as readonly string[]).includes(view);
}

/** Numeric level for a view (0 = full chrome … 3 = content only). Higher strips more. */
export function viewLevel(view: View): number {
  return VIEW_ORDER.indexOf(view);
}

/** True when `view` strips at least as much chrome as `threshold`. */
export function viewAtLeast(view: View, threshold: View): boolean {
  return viewLevel(view) >= viewLevel(threshold);
}
