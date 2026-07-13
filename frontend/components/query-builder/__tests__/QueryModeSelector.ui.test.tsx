/**
 * QueryModeSelector component unit tests (jsdom).
 *
 * Verifies the SQL / GUI / Viz segmented control: which tabs render, and the
 * disabled (greyed, non-clickable, tooltip) behaviour for GUI and Viz when the
 * current query can't be opened in the builder / has no results yet.
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { QueryModeSelector } from '@/components/query-builder';

describe('QueryModeSelector', () => {
  it('renders SQL, GUI and Viz tabs by default', () => {
    renderWithProviders(
      <QueryModeSelector mode="sql" onModeChange={vi.fn()} canUseGUI />
    );
    expect(screen.getByLabelText('SQL')).toBeTruthy();
    expect(screen.getByLabelText('GUI')).toBeTruthy();
    expect(screen.getByLabelText('Viz')).toBeTruthy();
  });

  it('omits the Viz tab entirely when showVizTab is false', () => {
    renderWithProviders(
      <QueryModeSelector mode="sql" onModeChange={vi.fn()} canUseGUI showVizTab={false} />
    );
    expect(screen.queryByLabelText('Viz')).toBeNull();
  });

  it('disables (not hides) the GUI tab when canUseGUI is false', () => {
    const onModeChange = vi.fn();
    renderWithProviders(
      <QueryModeSelector
        mode="sql"
        onModeChange={onModeChange}
        canUseGUI={false}
        guiError="This query cannot be edited in GUI mode"
      />
    );
    const gui = screen.getByLabelText('GUI');
    expect(gui.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(gui);
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it('disables (not hides) the Viz tab when canUseViz is false', () => {
    const onModeChange = vi.fn();
    renderWithProviders(
      <QueryModeSelector
        mode="sql"
        onModeChange={onModeChange}
        canUseGUI
        canUseViz={false}
        vizError="Run the query to configure a chart"
      />
    );
    const viz = screen.getByLabelText('Viz');
    expect(viz.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(viz);
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it('renders a Simple tab and switches to it when enabled', () => {
    const onModeChange = vi.fn();
    renderWithProviders(
      <QueryModeSelector mode="sql" onModeChange={onModeChange} canUseGUI canUseSimple />
    );
    const simple = screen.getByLabelText('Simple');
    expect(simple.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(simple);
    expect(onModeChange).toHaveBeenCalledWith('simple');
  });

  it('disables (not hides) the Simple tab when canUseSimple is false', () => {
    const onModeChange = vi.fn();
    renderWithProviders(
      <QueryModeSelector
        mode="sql"
        onModeChange={onModeChange}
        canUseGUI
        canUseSimple={false}
        simpleError="Not available in Simple mode: joins"
      />
    );
    const simple = screen.getByLabelText('Simple');
    expect(simple.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(simple);
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it('hides the Semantic tab by default and shows it with showSemanticTab', () => {
    const onModeChange = vi.fn();
    const { unmount } = renderWithProviders(
      <QueryModeSelector mode="sql" onModeChange={onModeChange} canUseGUI />
    );
    expect(screen.queryByLabelText('Semantic')).toBeNull();
    unmount();

    renderWithProviders(
      <QueryModeSelector mode="sql" onModeChange={onModeChange} canUseGUI showSemanticTab />
    );
    const semantic = screen.getByLabelText('Semantic');
    expect(semantic.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(semantic);
    expect(onModeChange).toHaveBeenCalledWith('semantic');
  });

  it('allows switching to Viz when canUseViz is true (default)', () => {
    const onModeChange = vi.fn();
    renderWithProviders(
      <QueryModeSelector mode="sql" onModeChange={onModeChange} canUseGUI />
    );
    const viz = screen.getByLabelText('Viz');
    expect(viz.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(viz);
    expect(onModeChange).toHaveBeenCalledWith('viz');
  });
});
