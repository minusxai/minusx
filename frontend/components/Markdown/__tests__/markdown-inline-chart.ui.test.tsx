/**
 * Markdown's InlineChart — the {{query:id}} inline chart embed rendered inside report
 * markdown bodies. Mounts QuestionViewV2 in 'toolcall' mode with a chart vizSettings type
 * (not 'table'), which is the render path least covered elsewhere: this proves the
 * Container/View move (QuestionViewV2 now takes editMode/collapsedPanel/onTogglePanel/
 * fileState/onSetFile as props instead of reading Redux internally) didn't break InlineChart,
 * one of QuestionViewV2's real mount sites.
 */
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import type { ReportQueryResult } from '@/lib/types';
import Markdown from '@/components/Markdown/index';

const queryData: ReportQueryResult = {
  query: 'select 1',
  columns: ['m', 'v'],
  types: ['text', 'number'],
  rows: [{ m: 'a', v: 1 }],
  vizSettings: { type: 'bar' },
  connectionId: 'demo_db',
};

describe('Markdown — InlineChart ({{query:id}})', () => {
  it('mounts QuestionViewV2 for a referenced query result', async () => {
    renderWithProviders(
      <Markdown queries={{ q1: queryData }}>{'{{query:q1}}'}</Markdown>,
    );

    // The Monaco editor loads async via next/dynamic, hence findBy.
    expect(await screen.findByLabelText('SQL editor')).toBeInTheDocument();
  });
});
