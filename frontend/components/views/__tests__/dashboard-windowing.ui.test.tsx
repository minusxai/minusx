/**
 * Tile windowing × capture (Renderer_v2 Phase 7 — the WINDOWING × CAPTURE gate).
 *
 * Question tiles render as layout GHOSTS until near the viewport (scroll/resize +
 * getBoundingClientRect with overscan — NOT IntersectionObserver, whose callbacks never fire
 * for foreignObject descendants; the real-browser proof lives in the capture-matrix `b2`
 * windowing fixture). Two properties are load-bearing and pinned here:
 *  1. A ghost stamps `data-mx-busy="true"` — so the capture readiness gate can NEVER settle on a
 *     dashboard that still shows ghosts (a send-time capture would faithfully serialize them).
 *  2. `waitForFileViewReady` FORCE-MOUNTS the ghosts (dispatches `mx-force-mount-tiles`), so a
 *     capture hydrates every tile, then waits for the tiles' own busy markers to clear.
 * jsdom has no layout (rects are all-zero, so everything reads as in-viewport and mounts —
 * which is why every existing DashboardView test keeps passing). These tests shrink
 * `window.innerHeight` far negative so the visibility check reads "off-screen", exercising the
 * ghost path explicitly.
 */
import React from 'react';
import { act, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { dashboardSurfaceDoc, withinDashboardSurface, dashboardViewBusy } from '@/test/helpers/dashboard-surface';
import * as storeModule from '@/store/store';
import DashboardContainerV2 from '@/components/containers/DashboardContainerV2';
import { setFile } from '@/store/filesSlice';
import { waitForFileViewReady, FORCE_MOUNT_TILES_EVENT } from '@/lib/screenshot/readiness';
import type { DbFile, DocumentContent, QuestionContent } from '@/lib/types';

vi.mock('@/components/containers/SmartEmbeddedQuestionContainer', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ questionId }: any) =>
      React.createElement('div', { 'aria-label': `Question content ${questionId}` }),
  };
});

vi.mock('react-grid-layout', () => {
  const React = require('react');
  return {
    __esModule: true,
    WidthProvider: (Comp: any) => Comp,
    Responsive: ({ children }: any) => React.createElement('div', { 'aria-label': 'Dashboard grid' }, children),
  };
});

vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { agentName: 'MinusX' } }, loading: false }),
}));

const DASH_ID = 100;
const Q1_ID = 201;

function makeDashboardFile(): DbFile {
  return {
    id: DASH_ID,
    name: 'Revenue Dashboard',
    type: 'dashboard' as const,
    path: '/org/Revenue Dashboard',
    content: {
      assets: [{ type: 'question', id: Q1_ID }],
      layout: { columns: 12, items: [{ id: Q1_ID, x: 0, y: 0, w: 6, h: 4 }] },
    } as DocumentContent,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    references: [] as number[],
    version: 1,
    last_edit_id: null,
  } as DbFile;
}

function makeQuestionFile(id: number): DbFile {
  return {
    id,
    name: `Question ${id}`,
    type: 'question' as const,
    path: `/org/Question ${id}`,
    content: { query: 'SELECT 1', vizSettings: { type: 'table' as const }, connection_name: '' } as QuestionContent,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    references: [] as number[],
    version: 1,
    last_edit_id: null,
  } as DbFile;
}

function setup() {
  const testStore = storeModule.makeStore();
  vi.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
  testStore.dispatch(setFile({ file: makeDashboardFile(), references: [] }));
  testStore.dispatch(setFile({ file: makeQuestionFile(Q1_ID), references: [] }));
  return testStore;
}

/** The raw jsdom top window. Inside the surface iframe, WindowedTile's frame-chain walk lands on
 *  `iframeWindow.parent` — which in the vitest jsdom environment is NOT the same object as the
 *  global `window` (a wrapper), so stamping innerHeight on `window` alone never reaches the
 *  visibility check. A throwaway probe iframe's `contentWindow.parent` resolves the same raw
 *  top-window object the walk sees (verified: identical to the surface iframe's parent). */
let rawTopWin: Window | null = null;
function rawTopWindow(): Window {
  if (rawTopWin) return rawTopWin;
  const probe = document.createElement('iframe');
  document.body.appendChild(probe);
  rawTopWin = probe.contentWindow!.parent;
  probe.remove();
  return rawTopWin;
}

/** jsdom rects are all-zero — a hugely NEGATIVE viewport makes `top < vh + overscan` false,
 *  so tiles read as off-screen and stay ghosts until scrolled/forced. Stamped on BOTH the global
 *  `window` and the raw top window (see rawTopWindow) so the check inside the surface iframe
 *  reads the same value. */
const setViewportHeight = (h: number) => {
  for (const w of new Set<Window>([window, rawTopWindow()])) {
    Object.defineProperty(w, 'innerHeight', { value: h, configurable: true, writable: true });
  }
};

beforeEach(() => {
  setViewportHeight(-10_000);
});

afterEach(() => {
  setViewportHeight(768);
  vi.restoreAllMocks();
});

/** Wait for the ghost to commit inside the surface iframe (Renderer_v2 Phase 8: the dashboard
 *  renders in DashboardSurface's iframe via a nested React root that commits ASYNCHRONOUSLY —
 *  waiting for the ghost first makes the tile-content absence checks non-vacuous). */
async function findGhost(): Promise<Element> {
  await waitFor(() => {
    expect(dashboardSurfaceDoc()?.querySelector('[data-mx-tile-ghost]')).toBeTruthy();
  });
  return dashboardSurfaceDoc()!.querySelector('[data-mx-tile-ghost]')!;
}

describe('dashboard tile windowing', () => {
  it('off-viewport question tiles render as BUSY ghosts (no tile content, data-mx-busy stamped)', async () => {
    const store = setup();
    renderWithProviders(<DashboardContainerV2 fileId={DASH_ID} mode="view" />, { store });

    const ghost = await findGhost();
    expect(withinDashboardSurface().queryByLabelText(`Question content ${Q1_ID}`)).not.toBeInTheDocument();
    expect(ghost.getAttribute('data-mx-busy')).toBe('true');
  });

  it('mounts the real tile when a scroll brings it into the overscan window', async () => {
    const store = setup();
    renderWithProviders(<DashboardContainerV2 fileId={DASH_ID} mode="view" />, { store });
    await findGhost();
    expect(withinDashboardSurface().queryByLabelText(`Question content ${Q1_ID}`)).not.toBeInTheDocument();

    setViewportHeight(768);
    // WindowedTile listens capture-phase on every document up the frame chain — a scroll on the
    // TOP document still reaches tiles inside the surface iframe.
    act(() => { document.dispatchEvent(new Event('scroll')); });
    // The scroll check is rAF-throttled — let the frame fire.
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });

    expect(await withinDashboardSurface().findByLabelText(`Question content ${Q1_ID}`)).toBeInTheDocument();
    expect(dashboardSurfaceDoc()!.querySelector('[data-mx-tile-ghost]')).toBeNull();
  });

  it('the force-mount event hydrates every ghost (the capture contract)', async () => {
    const store = setup();
    renderWithProviders(<DashboardContainerV2 fileId={DASH_ID} mode="view" />, { store });
    await findGhost();
    expect(withinDashboardSurface().queryByLabelText(`Question content ${Q1_ID}`)).not.toBeInTheDocument();

    // Ghosts listen for the force-mount broadcast on the TOP document (readiness.ts contract).
    act(() => { document.dispatchEvent(new CustomEvent(FORCE_MOUNT_TILES_EVENT)); });

    expect(await withinDashboardSurface().findByLabelText(`Question content ${Q1_ID}`)).toBeInTheDocument();
    expect(dashboardSurfaceDoc()!.querySelector('[data-mx-tile-ghost]')).toBeNull();
  });

  it('waitForFileViewReady force-mounts ghosts and only settles once they are gone', async () => {
    const store = setup();
    renderWithProviders(<DashboardContainerV2 fileId={DASH_ID} mode="view" />, { store });
    await findGhost();
    expect(withinDashboardSurface().queryByLabelText(`Question content ${Q1_ID}`)).not.toBeInTheDocument();

    await act(async () => {
      await waitForFileViewReady(DASH_ID, { timeoutMs: 3000, settleMs: 30, pollMs: 15 });
    });

    expect(withinDashboardSurface().getByLabelText(`Question content ${Q1_ID}`)).toBeInTheDocument();
    // Settled means NO busy markers remain in the view — top document OR inside the surface
    // iframe (the mounted stand-in is not busy).
    expect(dashboardViewBusy()).toBe(false);
  });
});
