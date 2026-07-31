/**
 * Dashboard grid width contract: the grid lays out at the SURFACE's
 * provided width (SurfaceWidthContext), not at a WidthProvider self-measurement — the
 * resize-observer-polyfill behind WidthProvider never fires inside the surface iframe, which
 * left grids laid out at a stale mount width, clipped at the pane edge (user-reported).
 *
 * DashboardView is rendered DIRECTLY (no surface) with the context provided, and with the REAL
 * react-grid-layout, so this characterizes the pure width → item-geometry contract in jsdom.
 */
import { describe, it, expect, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import DashboardView from '../DashboardView';
import { SurfaceWidthContext } from '@/lib/dashboard-surface/surface-width';
import type { DocumentContent } from '@/lib/types';

vi.mock('@/components/containers/SmartEmbeddedQuestionContainer', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ questionId }: { questionId: number }) =>
      React.createElement('div', { 'aria-label': `Question content ${questionId}` }),
  };
});

const Q1_ID = 201;
const noop = () => {};
const doc: DocumentContent = {
  assets: [{ type: 'question', id: Q1_ID }],
  layout: { columns: 12, items: [{ id: Q1_ID, x: 0, y: 0, w: 6, h: 2 }] },
} as DocumentContent;

function renderAt(width: number | null) {
  return renderWithProviders(
    <SurfaceWidthContext.Provider value={width}>
      <DashboardView
        document={doc}
        folderPath="/tutorial"
        fileId={100}
        onChange={noop}
        editMode={false}
        isDirty={false}
        paramValues={{}}
        lastExecutedParams={{}}
        questionContents={[undefined]}
        fileState={undefined}
        dirtyFiles={[]}
        onTextBlockContentChange={noop}
        onQuestionEdit={noop}
        onParamSubmit={noop}
        onAddQuestion={noop}
        onAddTextBlock={noop}
      />
    </SurfaceWidthContext.Provider>,
  );
}

/** The rendered grid item's inline width (react-grid-layout computes it from the width prop). */
function itemWidth(container: HTMLElement): number {
  const item = container.querySelector('.react-grid-item') as HTMLElement | null;
  expect(item).not.toBeNull();
  return parseFloat(item!.style.width);
}

function itemRight(container: HTMLElement): number {
  const item = container.querySelector('.react-grid-item') as HTMLElement | null;
  expect(item).not.toBeNull();
  const translateX = item!.style.transform.match(/translate\(([-\d.]+)px/)?.[1];
  expect(translateX).toBeDefined();
  return Number(translateX) + parseFloat(item!.style.width);
}

describe('dashboard grid width is surface-driven', () => {
  it('uses the current surface width rather than a stale pane-width reservation', async () => {
    const { container } = renderAt(1240);
    await waitFor(() => expect(container.querySelector('.react-grid-item')).not.toBeNull());
    const region = container.querySelector('[aria-label="Dashboard"]') as HTMLElement;
    expect(region.className).not.toContain('px-10');
    // 6 of 12 cols of the full 1240px surface with 6px margins ≈ 617; jsdom has no layout, so the inline
    // style IS the contract. A WidthProvider self-measure in jsdom collapses to its 1280
    // default regardless of the provided width — the range below rules that out.
    const w = itemWidth(container as HTMLElement);
    expect(w).toBeGreaterThan(600);
    expect(w).toBeLessThan(640);
  });

  it('re-lays out when the provided surface width changes (the polyfill never did)', async () => {
    // Both widths sit in the SAME (lg) breakpoint, so the item's col-span is constant and only
    // the provided width can move its pixel size — a self-measuring grid renders both identical.
    const first = renderAt(1240);
    await waitFor(() => expect(first.container.querySelector('.react-grid-item')).not.toBeNull());
    const narrow = itemWidth(first.container as HTMLElement);
    first.unmount();

    const second = renderAt(2000);
    await waitFor(() => expect(second.container.querySelector('.react-grid-item')).not.toBeNull());
    const wide = itemWidth(second.container as HTMLElement);
    expect(wide).toBeGreaterThan(narrow + 200);
  });

  it('keeps a rightmost card border inside the clipped surface', async () => {
    const rightEdgeDoc = {
      ...doc,
      layout: { columns: 12, items: [{ id: Q1_ID, x: 9, y: 0, w: 3, h: 2 }] },
    } as DocumentContent;
    const { container } = renderWithProviders(
      <SurfaceWidthContext.Provider value={740}>
        <DashboardView
          document={rightEdgeDoc}
          folderPath="/tutorial"
          fileId={100}
          onChange={noop}
          editMode={false}
          isDirty={false}
          paramValues={{}}
          lastExecutedParams={{}}
          questionContents={[undefined]}
          fileState={undefined}
          dirtyFiles={[]}
          onTextBlockContentChange={noop}
          onQuestionEdit={noop}
          onParamSubmit={noop}
          onAddQuestion={noop}
          onAddTextBlock={noop}
        />
      </SurfaceWidthContext.Provider>,
    );

    await waitFor(() => expect(container.querySelector('.react-grid-item')).not.toBeNull());
    // With zero grid padding RGL's independent rounding produces 741px here. The dashboard
    // surface is exactly 740px wide and clips overflow, so that extra pixel used to erase the
    // card's right border.
    expect(itemRight(container as HTMLElement)).toBeLessThanOrEqual(740);
  });
});
