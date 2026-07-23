/**
 * UI-test helpers for the self-contained dashboard surface (Renderer_v2 Phase 8): the dashboard
 * view renders inside DashboardSurface's IFRAME (nested React root), so testing-library's
 * `screen` — bound to the TOP document — cannot see it. These helpers bind the same aria-label
 * queries to the surface's document instead.
 *
 * The nested root commits ASYNCHRONOUSLY after the container renders: prefer `findBy*` (or wrap
 * in waitFor) for presence right after a render; `queryBy*` absence checks are meaningful only
 * once something else from the surface is visible.
 */
import { within, type BoundFunctions, type queries } from '@testing-library/dom';

/** The dashboard surface iframe's document, or null before the surface has mounted. */
export function dashboardSurfaceDoc(root: ParentNode = document): Document | null {
  const iframe = root.querySelector('iframe[aria-label="Dashboard document"]') as HTMLIFrameElement | null;
  return iframe?.contentDocument ?? null;
}

/** Bound queries over the dashboard surface's body. Throws if the surface is not mounted. */
export function withinDashboardSurface(root: ParentNode = document): BoundFunctions<typeof queries> {
  const doc = dashboardSurfaceDoc(root);
  if (!doc) throw new Error('dashboard surface iframe not found — did the container render?');
  return within(doc.body);
}

/** True when a busy marker remains anywhere in the view — INCLUDING inside the surface iframe
 *  (mirrors the production readiness scan, lib/screenshot/readiness.ts). */
export function dashboardViewBusy(root: ParentNode = document): boolean {
  if (root.querySelector('[data-mx-busy="true"]')) return true;
  const doc = dashboardSurfaceDoc(root);
  return !!doc?.querySelector('[data-mx-busy="true"]');
}
