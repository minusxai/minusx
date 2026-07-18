/**
 * V1→V2 bridge on the EDITABLE question surface (Viz Arch V2 §21) — with V2 as
 * the DEFAULT authoritative format: a legacy question (vizSettings only, no
 * `viz` envelope) opens straight into the V2 experience. The Viz tab shows the
 * V2 panel over the JIT-CONVERTED envelope, and the first edit writes a real
 * `viz` onto the content (the file upgrades on Save) while `vizSettings` stays
 * untouched — it remains the rollback path if the workspace flips back to V1.
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

describe('legacy question (vizSettings only), V2-default mode', () => {
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

  it('the first V2 edit writes a real `viz` envelope — and never touches vizSettings', async () => {
    const user = userEvent.setup();
    const onChange = mount();

    await user.click(screen.getByLabelText('Viz'));
    // Remove a folded measure — any V2 panel edit must produce content.viz.
    await screen.findByLabelText('Zone chip revenue');
    await user.click(screen.getByLabelText('Remove revenue'));

    const calls = onChange.mock.calls.map(c => c[0] as Record<string, unknown>);
    const withViz = calls.find(c => c.viz != null);
    expect(withViz).toBeTruthy();
    expect((withViz!.viz as { version: number }).version).toBe(2);
    // Non-destructive: the V1 settings are the rollback path — no edit may alter them.
    expect(calls.every(c => !('vizSettings' in c))).toBe(true);
  });
});
