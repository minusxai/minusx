/**
 * V1→V2 render bridge on the EDITABLE question surface (Viz Arch V2 §21) —
 * RENDER-ONLY contract, default (V1-authoritative) mode: a legacy question
 * (vizSettings only, no `viz` envelope) renders its CHART through vega via the
 * just-in-time converter, but stays V1 in the file and in the editor: the Viz
 * tab shows the CLASSIC config panel, edits go to `vizSettings`, and nothing
 * ever writes a `viz` envelope onto the content. V2 authoring arrives with the
 * prompts/tools flip, not before.
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

describe('legacy question (vizSettings only), default mode — vega renders, V1 edits', () => {
  it('the Viz tab keeps the CLASSIC config panel (no V2 drop zones)', async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByLabelText('Viz'));

    // Classic type selector present (the V1 config surface)…
    expect(await screen.findByLabelText('Line')).toBeInTheDocument();
    // …and the V2 drop-zone lens absent — the panel never edits a converted envelope.
    expect(screen.queryByLabelText('Vega encoding drop zones')).not.toBeInTheDocument();
  });

  it('panel edits write vizSettings — never a `viz` envelope', async () => {
    const user = userEvent.setup();
    const onChange = mount();

    await user.click(screen.getByLabelText('Viz'));
    await screen.findByLabelText('Bar');
    await user.click(screen.getByLabelText('Bar'));

    const calls = onChange.mock.calls.map(c => c[0] as Record<string, unknown>);
    expect(calls.some(c => (c.vizSettings as { type?: string } | undefined)?.type === 'bar')).toBe(true);
    expect(calls.every(c => c.viz == null)).toBe(true);
  });
});
