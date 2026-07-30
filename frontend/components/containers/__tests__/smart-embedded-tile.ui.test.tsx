/**
 * Tile chrome characterization (Renderer_v2 Phase 3): pins SmartEmbeddedQuestionContainer's
 * user-visible behavior across the Chakra→kit re-skin — title link vs plain title, the
 * actions menu (Explain/Edit/Remove), edit-mode overlay buttons, loading state. Behavior
 * only; no pixel/classname assertions, so the re-skin swaps styling freely underneath.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { setFile } from '@/store/filesSlice';
import type { DbFile, QuestionContent } from '@/lib/types';

vi.mock('@/components/containers/EmbeddedQuestionContainer', () => ({
  __esModule: true,
  default: ({ questionId }: { questionId: number }) => (
    <div aria-label={`Embedded question body ${questionId}`} />
  ),
}));
vi.mock('@/lib/hooks/useExplainQuestion', () => {
  const explainQuestion = vi.fn();
  return { useExplainQuestion: () => ({ explainQuestion }), __explainSpy: explainQuestion };
});

import SmartEmbeddedQuestionContainer from '@/components/containers/SmartEmbeddedQuestionContainer';
import * as explainModule from '@/lib/hooks/useExplainQuestion';

const Q_ID = 301;

function makeQuestionFile(vizType: string = 'table', viz?: unknown): DbFile {
  return {
    id: Q_ID,
    name: 'Revenue by Region',
    type: 'question' as const,
    path: '/org/Revenue by Region',
    content: (viz
      // Viz-first: `viz` is authoritative and vizSettings is absent entirely.
      ? { query: 'SELECT 1', viz, connection_name: '' }
      : { query: 'SELECT 1', vizSettings: { type: vizType as 'table' }, connection_name: '' }) as QuestionContent,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    references: [] as number[],
    version: 1,
    last_edit_id: null,
  } as DbFile;
}

function setup(vizType?: string, viz?: unknown) {
  const store = storeModule.makeStore();
  vi.spyOn(storeModule, 'getStore').mockReturnValue(store);
  store.dispatch(setFile({ file: makeQuestionFile(vizType, viz), references: [] }));
  return store;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('SmartEmbeddedQuestionContainer chrome', () => {
  it('renders the title as a link to the question (with dashboard context) and mounts the body', async () => {
    const store = setup();
    renderWithProviders(
      <SmartEmbeddedQuestionContainer questionId={Q_ID} showTitle dashboardId={9} />,
      { store },
    );
    const title = await screen.findByText('Revenue by Region');
    expect(title.closest('a')?.getAttribute('href')).toContain(`/f/${Q_ID}?dashboard=9`);
    expect(await screen.findByLabelText(`Embedded question body ${Q_ID}`)).toBeInTheDocument();
  });

  it('readOnly: plain title, no link, no actions menu', async () => {
    const store = setup();
    renderWithProviders(
      <SmartEmbeddedQuestionContainer questionId={Q_ID} showTitle readOnly />,
      { store },
    );
    const title = await screen.findByText('Revenue by Region');
    expect(title.closest('a')).toBeNull();
    expect(screen.queryByLabelText('Card actions')).not.toBeInTheDocument();
  });

  it('actions menu opens with Explain / Edit / Remove; Explain calls the hook, Remove fires', async () => {
    const store = setup();
    const onRemove = vi.fn();
    renderWithProviders(
      <SmartEmbeddedQuestionContainer questionId={Q_ID} showTitle onRemove={onRemove} />,
      { store },
    );
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('Card actions'));
    const explainItem = await screen.findByLabelText('Explain chart');
    expect(explainItem.closest('[data-slot="dropdown-menu-content"]')).toHaveAttribute('data-mx-theme-host');
    await user.click(explainItem);
    const explainSpy = (explainModule as unknown as { __explainSpy: ReturnType<typeof vi.fn> }).__explainSpy;
    expect(explainSpy).toHaveBeenCalledWith(Q_ID);

    await user.click(await screen.findByLabelText('Card actions'));
    await user.click(await screen.findByLabelText('Remove from dashboard'));
    expect(onRemove).toHaveBeenCalled();
  });

  it('edit mode: overlay edit/remove buttons present, no actions menu, title not clickable', async () => {
    const store = setup();
    const onEdit = vi.fn(); const onRemove = vi.fn();
    renderWithProviders(
      <SmartEmbeddedQuestionContainer questionId={Q_ID} showTitle editMode onEdit={onEdit} onRemove={onRemove} />,
      { store },
    );
    await screen.findByText('Revenue by Region');
    expect(screen.queryByLabelText('Card actions')).not.toBeInTheDocument();
    const actionBar = screen.getByLabelText('Edit question').parentElement;
    expect(actionBar).not.toHaveClass('opacity-0');
    expect(actionBar).toHaveClass('bg-popover', 'border-border');
    expect(screen.getByLabelText('Edit question')).toHaveClass('text-muted-foreground');
    expect(screen.getByLabelText('Remove from dashboard')).toHaveClass('hover:text-destructive');
    fireEvent.click(screen.getByLabelText('Edit question'));
    expect(onEdit).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Remove from dashboard'));
    expect(onRemove).toHaveBeenCalled();
  });

  it('edit mode: the drag surface covers the whole tile for a static chart', async () => {
    // Unchanged behaviour for everything that has nothing to interact with:
    // grabbing anywhere on the card drags it.
    const store = setup('table');
    renderWithProviders(<SmartEmbeddedQuestionContainer questionId={Q_ID} showTitle editMode />, { store });
    await screen.findByText('Revenue by Region');
    expect(screen.getByLabelText('Drag tile')).toHaveClass('inset-0');
  });

  it('edit mode: the drag surface does NOT cover an interactive map', async () => {
    // A full-tile drag surface sits above the chart and eats every wheel, drag and
    // hover before Vega sees them — so pan/zoom/tooltips are dead on exactly the
    // charts that have them. Geo charts get a header-strip grab area instead, which
    // keeps the tile draggable without owning the whole surface.
    for (const vizType of ['choropleth', 'point_map', 'geo']) {
      const store = setup(vizType);
      const { unmount } = renderWithProviders(
        <SmartEmbeddedQuestionContainer questionId={Q_ID} showTitle editMode />, { store });
      await screen.findByText('Revenue by Region');
      const handle = screen.getByLabelText('Drag tile');
      expect(handle, vizType).not.toHaveClass('inset-0');
      expect(handle, vizType).toHaveClass('top-0');
      unmount();
    }
  });

  it('edit mode: spares a VIZ-FIRST map, where legacy vizSettings does not exist', async () => {
    // `viz` is authoritative when present and `vizSettings` is then ignored — a
    // viz-first file omits it entirely. Reading only the legacy field therefore
    // classifies every V2-authored map as static and re-covers it with the
    // full-card overlay, which is the exact bug this fix exists to remove.
    for (const recipe of ['minusx/choropleth@1', 'minusx/point-map@1']) {
      const store = setup(undefined, { source: { kind: 'recipe', recipe }, encoding: {} });
      const { unmount } = renderWithProviders(
        <SmartEmbeddedQuestionContainer questionId={Q_ID} showTitle editMode />, { store });
      await screen.findByText('Revenue by Region');
      expect(screen.getByLabelText('Drag tile'), recipe).not.toHaveClass('inset-0');
      unmount();
    }
  });

  it('edit mode: spares a DETACHED map, which has no recipe id left', async () => {
    // Detaching a map drops the recipe id but keeps the signals, so capability —
    // the mxViewParams signal — is what identifies it, not the id.
    const store = setup(undefined, {
      source: { kind: 'vega', spec: { signals: [{ name: 'mxViewParams' }] } }, encoding: {},
    });
    renderWithProviders(<SmartEmbeddedQuestionContainer questionId={Q_ID} showTitle editMode />, { store });
    await screen.findByText('Revenue by Region');
    expect(screen.getByLabelText('Drag tile')).not.toHaveClass('inset-0');
  });

  it('unknown question id: shows the loading state, never a crash', () => {
    const store = storeModule.makeStore();
    vi.spyOn(storeModule, 'getStore').mockReturnValue(store);
    renderWithProviders(<SmartEmbeddedQuestionContainer questionId={999} showTitle />, { store });
    expect(screen.queryByText('Revenue by Region')).not.toBeInTheDocument();
  });
});
