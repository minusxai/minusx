/**
 * QueryModeSelector component unit tests (jsdom).
 *
 * Verifies the Semantic / SQL / Viz segmented control: Semantic hidden unless
 * the context defines models, disabled (with reason) when the SQL doesn't
 * detect; Viz gating unchanged.
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { QueryModeSelector } from '@/components/query-builder';

describe('QueryModeSelector', () => {
  it('renders SQL and Viz by default; Semantic only with showSemanticTab', () => {
    const { unmount } = renderWithProviders(
      <QueryModeSelector mode="sql" onModeChange={vi.fn()} />
    );
    expect(screen.getByLabelText('SQL')).toBeTruthy();
    expect(screen.getByLabelText('Viz')).toBeTruthy();
    expect(screen.queryByLabelText('Explore')).toBeNull();
    unmount();

    renderWithProviders(
      <QueryModeSelector mode="sql" onModeChange={vi.fn()} showSemanticTab />
    );
    expect(screen.getByLabelText('Explore')).toBeTruthy();
  });

  it('switches to Semantic when enabled', () => {
    const onModeChange = vi.fn();
    renderWithProviders(
      <QueryModeSelector mode="sql" onModeChange={onModeChange} showSemanticTab canUseSemantic />
    );
    fireEvent.click(screen.getByLabelText('Explore'));
    expect(onModeChange).toHaveBeenCalledWith('semantic');
  });

  it('disables (not hides) Semantic when the query does not detect', () => {
    const onModeChange = vi.fn();
    renderWithProviders(
      <QueryModeSelector
        mode="sql"
        onModeChange={onModeChange}
        showSemanticTab
        canUseSemantic={false}
        semanticError="This SQL is not expressible with the semantic model"
      />
    );
    const semantic = screen.getByLabelText('Explore');
    expect(semantic.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(semantic);
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it('omits the Viz tab entirely when showVizTab is false', () => {
    renderWithProviders(
      <QueryModeSelector mode="sql" onModeChange={vi.fn()} showVizTab={false} />
    );
    expect(screen.queryByLabelText('Viz')).toBeNull();
  });

  it('disables (not hides) the Viz tab when canUseViz is false', () => {
    const onModeChange = vi.fn();
    renderWithProviders(
      <QueryModeSelector
        mode="sql"
        onModeChange={onModeChange}
        canUseViz={false}
        vizError="Run the query to configure a chart"
      />
    );
    const viz = screen.getByLabelText('Viz');
    expect(viz.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(viz);
    expect(onModeChange).not.toHaveBeenCalled();
  });
});
