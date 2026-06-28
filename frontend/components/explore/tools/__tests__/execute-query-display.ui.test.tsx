/**
 * ExecuteQueryDisplay — the ExecuteQuery server-tool row in chat. Regression guard for the bug
 * where a query that renders as a *table* (the default viz, e.g. an aggregate like "total MRR")
 * was hidden entirely in compact view unless the user expanded "Show Thinking" — so the one
 * server tool that ran the SQL never appeared in the conversation. The row must ALWAYS render
 * (collapsed), like SearchDBSchema/SearchFiles. Located by aria-label only (project rule).
 */
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import type { DisplayProps } from '@/lib/types';
import ExecuteQueryDisplay from '../ExecuteQueryDisplay';

const ROW_LABEL = 'Execute SQL tool call';

const toolMsg = (details: unknown) =>
  ({ role: 'tool', tool_call_id: 'q1', function: { name: 'ExecuteQuery' }, content: '', details }) as never;

const props = (args: Record<string, unknown>, details: unknown, showThinking = false): DisplayProps =>
  ({
    toolCallTuple: [{ id: 'q1', type: 'function', function: { name: 'ExecuteQuery', arguments: args } }, toolMsg(details)],
    isCompact: true,
    showThinking,
  }) as unknown as DisplayProps;

const tableResult = { success: true, queryResult: { columns: ['total'], types: ['number'], rows: [[18283]] } };
const chartArgs = { query: 'select 1', vizSettings: { type: 'bar' } };

describe('ExecuteQueryDisplay (compact)', () => {
  it('renders the Execute SQL row for a TABLE query even when thinking is collapsed', () => {
    // The bug: a table-viz query stayed hidden behind Show Thinking. It must always show.
    renderWithProviders(<ExecuteQueryDisplay {...props({ query: 'select sum(x) total from t' }, tableResult, false)} />);
    expect(screen.getByLabelText(ROW_LABEL)).toBeInTheDocument();
  });

  it('renders the Execute SQL row for a CHART query (regression guard)', () => {
    renderWithProviders(<ExecuteQueryDisplay {...props(chartArgs, { success: true, queryResult: { columns: ['m', 'v'], types: ['text', 'number'], rows: [['a', 1]] } }, false)} />);
    expect(screen.getByLabelText(ROW_LABEL)).toBeInTheDocument();
  });

  it('renders the Execute SQL row when the query errored', () => {
    renderWithProviders(<ExecuteQueryDisplay {...props({ query: 'select bad' }, { success: false, error: 'boom' }, false)} />);
    expect(screen.getByLabelText(ROW_LABEL)).toBeInTheDocument();
  });
});
