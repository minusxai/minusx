/**
 * DashboardView — characterizes CURRENT (pre-move) Redux behavior ahead of the
 * Container/View discipline move (CLAUDE.md "Refactoring — Blue -> Red -> Blue").
 * DashboardView.tsx currently calls useAppDispatch/
 * useAppSelector directly at 8 sites (grep-verified): selectFileEditMode,
 * selectIsDirty, selectMergedContent (dashboard-level parameterValues),
 * ephemeralChanges.lastExecuted.params, questionContents (per-question
 * selectMergedContent), state.files.files[fileId] (fileState), selectDirtyFiles,
 * plus dispatch(...) for updateTextBlockContent/pushView/setEphemeral/
 * addQuestionToDashboard/addTextBlockToDashboard.
 *
 * Mounted via DashboardContainerV2 (NOT DashboardView directly): the
 * container's fileId/mode contract is stable across the refactor, so these
 * same tests — unchanged — must keep passing once the hook calls move up from
 * the view into the container. Rendering DashboardView directly would break
 * across the move since its prop interface is exactly what's being extended.
 *
 * Heavy leaf components are mocked to small aria-labeled stand-ins (repo
 * convention — see chat-input.ui.test.tsx / notebook-view.ui.test.tsx):
 * SmartEmbeddedQuestionContainer, QuestionBrowserPanel, TextBlockCard.
 * react-grid-layout is mocked to a plain passthrough that reports mounts, so
 * the isDirty -> gridVersion remount (DashboardView.tsx:97-105) is directly
 * observable without depending on the real library's drag/resize internals.
 *
 * All element queries by aria-label only (CLAUDE.md convention). One
 * presentational aria-label was added to DashboardView.tsx's question-tile
 * wrapper (`Dashboard tile <id>[ (mark)]`) since the publish/edit highlight
 * state (fileState/dirtyFiles-driven) had no other observable affordance.
 *
 * Renderer_v2 Phase 8: the dashboard view renders inside DashboardSurface's
 * same-origin IFRAME (nested React root, commits asynchronously after the
 * container render) — so all dashboard content is queried through
 * withinDashboardSurface() (test/helpers/dashboard-surface.ts), using findBy
 * queries or waitFor for the async commit. Only the top-document chrome
 * (capture anchor, PageMarkerDevOverlay) stays on `screen`.
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { dashboardSurfaceDoc, withinDashboardSurface } from '@/test/helpers/dashboard-surface';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { setFile, setEdit, setEphemeral, clearEdits } from '@/store/filesSlice';
import { setFileEditMode, setDevMode } from '@/store/uiSlice';
import DashboardContainerV2 from '@/components/containers/DashboardContainerV2';
import type { DbFile, DocumentContent, QuestionContent } from '@/lib/types';

// ─── Mocks for heavy leaf components (repo convention: small aria-labeled stand-ins) ───

vi.mock('@/components/containers/SmartEmbeddedQuestionContainer', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ questionId, editMode, onEdit, onRemove }: any) =>
      React.createElement(
        'div',
        { 'aria-label': `Question content ${questionId}` },
        editMode && React.createElement('button', { 'aria-label': `Edit question ${questionId}`, onClick: onEdit }, 'Edit'),
        editMode && React.createElement('button', { 'aria-label': `Remove question ${questionId}`, onClick: onRemove }, 'Remove'),
      ),
  };
});

vi.mock('@/components/TextBlockCard', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ id, content, onContentChange, onRemove }: any) =>
      React.createElement(
        'div',
        { 'aria-label': `Text block ${id}` },
        React.createElement('button', {
          'aria-label': `Edit text block ${id}`,
          onClick: () => onContentChange(id, `${content}-edited`),
        }, 'Edit'),
        React.createElement('button', { 'aria-label': `Remove text block ${id}`, onClick: () => onRemove(id) }, 'Remove'),
      ),
  };
});

vi.mock('@/components/question/QuestionBrowserPanel', () => {
  const React = require('react');
  return {
    __esModule: true,
    QuestionBrowserPanel: ({ title, onAddQuestion, onAddTextBlock }: any) =>
      React.createElement(
        'div',
        { 'aria-label': title },
        React.createElement('button', {
          'aria-label': `${title}: add question 999`,
          onClick: () => onAddQuestion(999),
        }, 'Add question'),
        onAddTextBlock && React.createElement('button', {
          'aria-label': `${title}: add text block`,
          onClick: onAddTextBlock,
        }, 'Add text'),
      ),
  };
});

// react-grid-layout -> plain passthrough div that reports each mount, so the
// isDirty -> gridVersion remount (a `key` change on ResponsiveGridLayout) is
// directly observable via a mount counter instead of internal RGL state.
const { gridMountSpy } = vi.hoisted(() => ({ gridMountSpy: vi.fn() }));
vi.mock('react-grid-layout', () => {
  const React = require('react');
  function Responsive({ children }: any) {
    React.useEffect(() => { gridMountSpy(); }, []);
    return React.createElement('div', { 'aria-label': 'Dashboard grid' }, children);
  }
  return {
    __esModule: true,
    WidthProvider: (Comp: any) => Comp,
    Responsive,
  };
});

// DashboardEmptyState (rendered when the dashboard has no questions/text blocks) calls
// useConfigs() for the branding agentName. Mocked so its fire-and-forget /api/configs fetch
// never runs in jsdom.
vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { agentName: 'MinusX' } }, loading: false }),
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const DASH_ID = 100;
const Q1_ID = 201;
const Q2_ID = 202;

function makeDashboardFile(content: Partial<DocumentContent> = {}): DbFile {
  return {
    id: DASH_ID,
    name: 'Revenue Dashboard',
    type: 'dashboard' as const,
    path: '/org/Revenue Dashboard',
    content: {
      assets: [],
      layout: { columns: 12, items: [] },
      ...content,
    } as DocumentContent,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    references: [] as number[],
    version: 1,
    last_edit_id: null,
  } as DbFile;
}

function makeQuestionFile(id: number, content: Partial<QuestionContent> = {}): DbFile {
  return {
    id,
    name: `Question ${id}`,
    type: 'question' as const,
    path: `/org/Question ${id}`,
    content: {
      query: 'SELECT 1',
      vizSettings: { type: 'table' as const },
      connection_name: '',
      ...content,
    } as QuestionContent,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    references: [] as number[],
    version: 1,
    last_edit_id: null,
  } as DbFile;
}

function setup(dashboardFile: DbFile, questionFiles: DbFile[] = []) {
  const testStore = storeModule.makeStore();
  vi.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
  testStore.dispatch(setFile({ file: dashboardFile, references: [] }));
  questionFiles.forEach(q => testStore.dispatch(setFile({ file: q, references: [] })));
  return testStore;
}

afterEach(() => {
  vi.restoreAllMocks();
  gridMountSpy.mockClear();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('DashboardView via DashboardContainerV2', () => {
  // Call site: selectFileEditMode(state, fileId), combined with mode/readOnly override.
  describe('editMode (selectFileEditMode)', () => {
    it('passes the Redux fileEditMode down when mode="view"', async () => {
      const store = setup(
        makeDashboardFile({ assets: [{ type: 'question', id: Q1_ID }], layout: { columns: 12, items: [{ id: Q1_ID, x: 0, y: 0, w: 6, h: 4 }] } }),
        [makeQuestionFile(Q1_ID)],
      );
      store.dispatch(setFileEditMode({ fileId: DASH_ID, editMode: true }));

      renderWithProviders(<DashboardContainerV2 fileId={DASH_ID} mode="view" />, { store });

      expect(await withinDashboardSurface().findByLabelText(`Edit question ${Q1_ID}`)).toBeInTheDocument();
    });

    it('forces editMode=false in preview mode even when Redux fileEditMode is true', async () => {
      const store = setup(
        makeDashboardFile({ assets: [{ type: 'question', id: Q1_ID }], layout: { columns: 12, items: [{ id: Q1_ID, x: 0, y: 0, w: 6, h: 4 }] } }),
        [makeQuestionFile(Q1_ID)],
      );
      store.dispatch(setFileEditMode({ fileId: DASH_ID, editMode: true }));

      renderWithProviders(<DashboardContainerV2 fileId={DASH_ID} mode="preview" />, { store });

      // Wait for the surface content to commit first, so the absence check isn't vacuous.
      expect(await withinDashboardSurface().findByLabelText(`Question content ${Q1_ID}`)).toBeInTheDocument();
      expect(withinDashboardSurface().queryByLabelText(`Edit question ${Q1_ID}`)).not.toBeInTheDocument();
    });

    it('defaults to editMode=false when Redux fileEditMode is unset', async () => {
      const store = setup(
        makeDashboardFile({ assets: [{ type: 'question', id: Q1_ID }], layout: { columns: 12, items: [{ id: Q1_ID, x: 0, y: 0, w: 6, h: 4 }] } }),
        [makeQuestionFile(Q1_ID)],
      );

      renderWithProviders(<DashboardContainerV2 fileId={DASH_ID} mode="view" />, { store });

      // Wait for the surface content to commit first, so the absence check isn't vacuous.
      expect(await withinDashboardSurface().findByLabelText(`Question content ${Q1_ID}`)).toBeInTheDocument();
      expect(withinDashboardSurface().queryByLabelText(`Edit question ${Q1_ID}`)).not.toBeInTheDocument();
    });
  });

  // Call site: dispatch(updateTextBlockContent(...))
  it('dispatches updateTextBlockContent when a text block is edited', async () => {
    const TEXT_ID = 'abc-123';
    const store = setup(makeDashboardFile({
      assets: [{ type: 'text', id: TEXT_ID, content: 'hello' } as any],
      layout: { columns: 12, items: [{ id: TEXT_ID, x: 0, y: 0, w: 12, h: 3 }] },
    }));

    renderWithProviders(<DashboardContainerV2 fileId={DASH_ID} mode="view" />, { store });

    fireEvent.click(await withinDashboardSurface().findByLabelText(`Edit text block ${TEXT_ID}`));

    const assets = (store.getState().files.files[DASH_ID].persistableChanges as any)?.assets;
    expect(assets.find((a: any) => a.id === TEXT_ID).content).toBe('hello-edited');
  });

  // Call site: selectIsDirty(state, fileId) -> gridVersion remount workaround
  it('remounts the grid when the dashboard transitions from dirty to clean (selectIsDirty)', async () => {
    const store = setup(
      makeDashboardFile({ assets: [{ type: 'question', id: Q1_ID }], layout: { columns: 12, items: [{ id: Q1_ID, x: 0, y: 0, w: 6, h: 4 }] } }),
      [makeQuestionFile(Q1_ID)],
    );
    store.dispatch(setEdit({ fileId: DASH_ID, edits: { description: 'draft' } })); // isDirty: true

    renderWithProviders(<DashboardContainerV2 fileId={DASH_ID} mode="view" />, { store });

    expect(await withinDashboardSurface().findByLabelText('Dashboard grid')).toBeInTheDocument();
    const mountsWhileDirty = gridMountSpy.mock.calls.length;

    store.dispatch(clearEdits(DASH_ID)); // isDirty: true -> false

    await waitFor(() => {
      expect(gridMountSpy.mock.calls.length).toBeGreaterThan(mountsWhileDirty);
    });
  });

  // Call site: selectMergedContent(state, fileId) -> paramValues (dashboard-level persisted parameterValues)
  it('shows the dashboard-level persisted parameterValues in the filter row', async () => {
    const store = setup(
      makeDashboardFile({
        assets: [{ type: 'question', id: Q1_ID }],
        layout: { columns: 12, items: [{ id: Q1_ID, x: 0, y: 0, w: 6, h: 4 }] },
        parameterValues: { region: 'west' },
      }),
      [makeQuestionFile(Q1_ID, {
        query: 'select * from t where region = :region',
        parameters: [{ name: 'region', type: 'text', label: null, source: null }],
      })],
    );

    renderWithProviders(<DashboardContainerV2 fileId={DASH_ID} mode="view" />, { store });

    expect((await withinDashboardSurface().findByLabelText('region') as HTMLInputElement).value).toBe('west');
  });

  // Call site: raw selector on state.files.files[fileId]?.ephemeralChanges?.lastExecuted?.params
  it('prefers ephemeralChanges.lastExecuted.params over the persisted default when absent from paramValues', async () => {
    const store = setup(
      makeDashboardFile({
        assets: [{ type: 'question', id: Q1_ID }],
        layout: { columns: 12, items: [{ id: Q1_ID, x: 0, y: 0, w: 6, h: 4 }] },
        // No dashboard-level parameterValues set.
      }),
      [makeQuestionFile(Q1_ID, {
        query: 'select * from t where region = :region',
        parameters: [{ name: 'region', type: 'text', label: null, source: null }],
      })],
    );
    store.dispatch(setEphemeral({
      fileId: DASH_ID,
      changes: { lastExecuted: { query: '', params: { region: 'east' }, database: '' } },
    }));

    renderWithProviders(<DashboardContainerV2 fileId={DASH_ID} mode="view" />, { store });

    expect((await withinDashboardSurface().findByLabelText('region') as HTMLInputElement).value).toBe('east');
  });

  // Call site: questionContents = questionIds.map(id => selectMergedContent(state, id))
  it('dedupes identical parameters (same name+type) across multiple questions into a single filter row', async () => {
    const store = setup(
      makeDashboardFile({
        assets: [{ type: 'question', id: Q1_ID }, { type: 'question', id: Q2_ID }],
        layout: { columns: 12, items: [{ id: Q1_ID, x: 0, y: 0, w: 6, h: 4 }, { id: Q2_ID, x: 6, y: 0, w: 6, h: 4 }] },
      }),
      [
        makeQuestionFile(Q1_ID, { query: 'select * from a where region = :region', parameters: [{ name: 'region', type: 'text', label: null, source: null }] }),
        makeQuestionFile(Q2_ID, { query: 'select * from b where region = :region', parameters: [{ name: 'region', type: 'text', label: null, source: null }] }),
      ],
    );

    renderWithProviders(<DashboardContainerV2 fileId={DASH_ID} mode="view" />, { store });

    await waitFor(() => {
      expect(withinDashboardSurface().getAllByLabelText('Parameter region')).toHaveLength(1);
    });
    // Windowed tiles hydrate a few frames after the param row (empty-rect retry, Phase 8c) —
    // await them rather than asserting synchronously.
    expect(await withinDashboardSurface().findByLabelText(`Question content ${Q1_ID}`)).toBeInTheDocument();
    expect(await withinDashboardSurface().findByLabelText(`Question content ${Q2_ID}`)).toBeInTheDocument();
  });

  // Call sites: fileState = state.files.files[fileId], dirtyFiles = selectDirtyFiles(state)
  describe('publish/edit highlights (fileState, dirtyFiles)', () => {
    it('marks a newly-added question as "added" while editing', async () => {
      const store = setup(
        makeDashboardFile({ assets: [{ type: 'question', id: Q1_ID }], layout: { columns: 12, items: [{ id: Q1_ID, x: 0, y: 0, w: 6, h: 4 }] } }),
        [makeQuestionFile(Q1_ID), makeQuestionFile(Q2_ID)],
      );
      store.dispatch(setFileEditMode({ fileId: DASH_ID, editMode: true }));
      // Simulate having added Q2 (dashboard-level persistableChanges, not yet saved).
      store.dispatch(setEdit({
        fileId: DASH_ID,
        edits: {
          assets: [{ type: 'question', id: Q1_ID }, { type: 'question', id: Q2_ID }],
          layout: { columns: 12, items: [{ id: Q1_ID, x: 0, y: 0, w: 6, h: 4 }, { id: Q2_ID, x: 6, y: 0, w: 6, h: 4 }] },
        },
      }));

      renderWithProviders(<DashboardContainerV2 fileId={DASH_ID} mode="view" />, { store });

      expect(await withinDashboardSurface().findByLabelText(`Dashboard tile ${Q2_ID} (added)`)).toBeInTheDocument();
      expect(withinDashboardSurface().getByLabelText(`Dashboard tile ${Q1_ID}`)).toBeInTheDocument(); // unchanged, no suffix
    });

    it('marks a question as "edited" when its own file (not the dashboard) is dirty', async () => {
      const store = setup(
        makeDashboardFile({ assets: [{ type: 'question', id: Q1_ID }], layout: { columns: 12, items: [{ id: Q1_ID, x: 0, y: 0, w: 6, h: 4 }] } }),
        [makeQuestionFile(Q1_ID)],
      );
      store.dispatch(setFileEditMode({ fileId: DASH_ID, editMode: true }));
      // Q1's own file is dirty (e.g. an agent edit) — the dashboard itself is unedited.
      store.dispatch(setEdit({ fileId: Q1_ID, edits: { query: 'select 2' } }));

      renderWithProviders(<DashboardContainerV2 fileId={DASH_ID} mode="view" />, { store });

      expect(await withinDashboardSurface().findByLabelText(`Dashboard tile ${Q1_ID} (edited)`)).toBeInTheDocument();
    });
  });

  // Call site: dispatch(pushView(...)) on a question tile's Edit button
  it('dispatches pushView with the dashboardParamValues when a question tile Edit button is clicked', async () => {
    const store = setup(
      makeDashboardFile({ assets: [{ type: 'question', id: Q1_ID }], layout: { columns: 12, items: [{ id: Q1_ID, x: 0, y: 0, w: 6, h: 4 }] } }),
      [makeQuestionFile(Q1_ID)],
    );
    store.dispatch(setFileEditMode({ fileId: DASH_ID, editMode: true }));

    renderWithProviders(<DashboardContainerV2 fileId={DASH_ID} mode="view" />, { store });

    fireEvent.click(await withinDashboardSurface().findByLabelText(`Edit question ${Q1_ID}`));

    expect(store.getState().ui.viewStack).toEqual([
      { type: 'question', fileId: Q1_ID, dashboardId: DASH_ID, dashboardParamValues: {} },
    ]);
  });

  // Call sites: dispatch(addQuestionToDashboard(...)) / dispatch(addTextBlockToDashboard(...))
  describe('add question / add text block (addQuestionToDashboard, addTextBlockToDashboard)', () => {
    it('dispatches both actions from the empty-state panel', async () => {
      const store = setup(makeDashboardFile({ assets: [], layout: { columns: 12, items: [] } }));
      store.dispatch(setFileEditMode({ fileId: DASH_ID, editMode: true }));

      renderWithProviders(<DashboardContainerV2 fileId={DASH_ID} mode="view" />, { store });

      fireEvent.click(await withinDashboardSurface().findByLabelText('Add questions / text: add question 999'));
      expect((store.getState().files.files[DASH_ID].persistableChanges as any).assets)
        .toEqual([{ type: 'question', id: 999 }]);

      // Once non-empty, the empty-state panel is replaced by the "Add more" panel
      // (a real, distinct JSX branch — see the "Add more" describe block below).
      fireEvent.click(await withinDashboardSurface().findByLabelText('Add more questions / text: add text block'));
      const assetsAfterText = (store.getState().files.files[DASH_ID].persistableChanges as any).assets;
      expect(assetsAfterText).toHaveLength(2);
      expect(assetsAfterText[1].type).toBe('text');
    });

    it('dispatches addQuestionToDashboard from the "Add more" panel once the dashboard already has items', async () => {
      const store = setup(
        makeDashboardFile({ assets: [{ type: 'question', id: Q1_ID }], layout: { columns: 12, items: [{ id: Q1_ID, x: 0, y: 0, w: 6, h: 4 }] } }),
        [makeQuestionFile(Q1_ID)],
      );
      store.dispatch(setFileEditMode({ fileId: DASH_ID, editMode: true }));

      renderWithProviders(<DashboardContainerV2 fileId={DASH_ID} mode="view" />, { store });

      // Wait for the "Add more" panel to commit in the surface, so the empty-state
      // absence check isn't vacuous.
      const addMoreBtn = await withinDashboardSurface().findByLabelText('Add more questions / text: add question 999');
      expect(withinDashboardSurface().queryByLabelText('Add questions / text')).not.toBeInTheDocument();
      fireEvent.click(addMoreBtn);

      const assets = (store.getState().files.files[DASH_ID].persistableChanges as any).assets;
      expect(assets.map((a: any) => a.id)).toEqual([Q1_ID, 999]);
    });
  });

  // Dashboard themes (Renderer_v2 Phase 3, §9 Q2): content.theme stamps [data-theme] on the
  // dashboard root so the six story design-token sets restyle it; absent → no attribute (the
  // neutral app look).
  describe('design theme stamp', () => {
    it('stamps data-theme on the dashboard root from content.theme', async () => {
      const store = setup(makeDashboardFile({ theme: 'modernist' } as any));
      renderWithProviders(<DashboardContainerV2 fileId={DASH_ID} mode="view" />, { store });
      const region = await withinDashboardSurface().findByLabelText('Dashboard');
      expect(region.getAttribute('data-theme')).toBe('modernist');
    });

    it('no theme → no data-theme attribute', async () => {
      const store = setup(makeDashboardFile());
      renderWithProviders(<DashboardContainerV2 fileId={DASH_ID} mode="view" />, { store });
      const region = await withinDashboardSurface().findByLabelText('Dashboard');
      expect(region.hasAttribute('data-theme')).toBe(false);
    });
  });

  // Self-contained iframe surface (Renderer_v2 Phase 8): the dashboard content lives inside
  // DashboardSurface's same-origin IFRAME — [data-file-id] (capture anchor) >
  // iframe[aria-label="Dashboard document"] > #document > svg[data-mx-story-svg] > foreignObject.
  // The chrome stylesheet is injected IN-ROOT (style[data-mx-tw]) so a serialized capture of the
  // svg subtree is self-contained by construction.
  describe('live-svg surface', () => {
    it('mounts the dashboard region inside svg[data-mx-surface-svg] > foreignObject', async () => {
      const store = setup(makeDashboardFile());
      renderWithProviders(<DashboardContainerV2 fileId={DASH_ID} mode="view" />, { store });

      // The capture anchor wraps the surface iframe host in the TOP document.
      const iframe = document.querySelector(
        '[data-file-id] iframe[aria-label="Dashboard document"]',
      ) as HTMLIFrameElement | null;
      expect(iframe).toBeTruthy();

      // The region commits asynchronously in the iframe document, inside the svg surface.
      const region = await withinDashboardSurface().findByLabelText('Dashboard');
      expect(region.ownerDocument).toBe(iframe!.contentDocument);
      expect(region.ownerDocument).toBe(dashboardSurfaceDoc());
      const fo = region.closest('foreignObject');
      expect(fo).toBeTruthy();
      const svg = fo!.closest('svg[data-mx-story-svg]');
      expect(svg).toBeTruthy();

      // Self-containment: the chrome stylesheet lives IN-ROOT, so serializing the svg
      // subtree carries the dashboard chrome (grid styles) by construction.
      const tw = svg!.querySelector('style[data-mx-tw]');
      expect(tw).toBeTruthy();
      expect(tw!.textContent).toContain('.react-grid-item');
    });
  });

  // Dashboards are marker-flagged (Renderer_v2 Phase 1): under dev mode the same numbered
  // position-marker preview stories get (PageMarkerDevOverlay) must mount on the dashboard root,
  // so the DevTools Markers checkbox previews exactly what the agent capture bakes in.
  describe('page-marker dev overlay', () => {
    it('mounts when ui.devMode is on', () => {
      const store = setup(makeDashboardFile());
      store.dispatch(setDevMode(true));
      renderWithProviders(<DashboardContainerV2 fileId={DASH_ID} mode="view" />, { store });
      expect(screen.getByLabelText('Page marker dev overlay')).toBeInTheDocument();
    });

    it('does not mount without dev mode', () => {
      const store = setup(makeDashboardFile());
      renderWithProviders(<DashboardContainerV2 fileId={DASH_ID} mode="view" />, { store });
      expect(screen.queryByLabelText('Page marker dev overlay')).not.toBeInTheDocument();
    });
  });
});
