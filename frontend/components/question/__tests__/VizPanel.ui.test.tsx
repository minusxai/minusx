/**
 * VizPanel — the third column of the question surface, shown for ALL
 * questions (not just semantic ones). A slim header (title only — collapsing
 * happens on the resize handle, like the other columns) over the full viz
 * config, which the parent supplies as children. There are NO tabs here —
 * the query itself already lives in the left GUI/SQL column. The panel is a
 * SHELL: it owns no viz state; the parent keeps every VizConfigPanel handler
 * exactly where it already lives.
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { VizPanel } from '@/components/question/VizPanel';

describe('VizPanel', () => {
  it('shows the supplied config body under a slim header — no tabs, no close button', () => {
    renderWithProviders(
      <VizPanel>
        <div aria-label="Chart config body">config</div>
      </VizPanel>
    );
    expect(screen.getByLabelText('Viz panel')).toBeTruthy();
    expect(screen.getByLabelText('Chart config body')).toBeTruthy();
    // no tabs — the query lives in the left GUI/SQL column already
    expect(screen.queryByLabelText('Viz panel tab: SQL')).toBeNull();
    expect(screen.queryByLabelText('Viz panel tab: Chart')).toBeNull();
    // no close button — the resize handle's chevron collapses the panel
    expect(screen.queryByLabelText('Close viz panel')).toBeNull();
  });
});
