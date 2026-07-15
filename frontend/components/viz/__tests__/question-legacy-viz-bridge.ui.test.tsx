/**
 * V1→V2 bridge on the EDITABLE question surface (Viz Arch V2 §21): a legacy question
 * (vizSettings only, no `viz` envelope) opens straight into the V2 experience — the
 * Viz tab shows the V2 panel over the CONVERTED envelope (not the V1 ChartBuilder),
 * and the first edit writes a real `viz` onto the content (the file upgrades on Save).
 */
import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import QuestionViewV2 from '@/components/views/QuestionViewV2';
import type { QuestionContent } from '@/lib/types';

const legacyContent = {
  query: 'select week, orders, revenue from t',
  connection_name: 'demo_db',
  vizSettings: { type: 'line', xCols: ['week'], yCols: ['orders', 'revenue'] },
} as unknown as QuestionContent;

const queryData = {
  columns: ['week', 'orders', 'revenue'],
  types: ['TIMESTAMP', 'BIGINT', 'DOUBLE'],
  rows: [
    { week: '2025-01-06', orders: 10, revenue: 100 },
    { week: '2025-01-13', orders: 12, revenue: 140 },
  ],
};

function mount(onChange = vi.fn()) {
  renderWithProviders(
    <QuestionViewV2
      viewMode="toolcall"
      content={legacyContent}
      queryData={queryData}
      queryLoading={false}
      queryError={null}
      queryStale={false}
      editMode={false}
      collapsedPanel="none"
      onTogglePanel={() => {}}
      fileState={{}}
      onSetFile={() => {}}
      onChange={onChange}
      onExecute={() => {}}
    />,
  );
  return onChange;
}

describe('legacy question (vizSettings only) on the question surface', () => {
  it('the Viz tab shows the V2 panel over the converted envelope, not the V1 builder', async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByLabelText('Viz'));

    // V2 drop-zone lens present…
    expect(await screen.findByLabelText('Vega encoding drop zones')).toBeInTheDocument();
    // …with the converted line chart's zones populated (x + folded measures).
    expect(screen.getByLabelText('Zone chip week')).toBeInTheDocument();
    expect(screen.getByLabelText('Zone chip orders')).toBeInTheDocument();
    expect(screen.getByLabelText('Zone chip revenue')).toBeInTheDocument();
  });

  it('the first V2 edit writes a real `viz` envelope onto the content', async () => {
    const user = userEvent.setup();
    const onChange = mount();

    await user.click(screen.getByLabelText('Viz'));
    // Remove a folded measure — any V2 panel edit must produce content.viz.
    await screen.findByLabelText('Zone chip revenue');
    await user.click(screen.getByLabelText('Remove revenue'));

    const withViz = onChange.mock.calls.map(c => c[0]).find((c: Record<string, unknown>) => c.viz != null);
    expect(withViz).toBeTruthy();
    expect((withViz.viz as { version: number }).version).toBe(2);
  });
});
