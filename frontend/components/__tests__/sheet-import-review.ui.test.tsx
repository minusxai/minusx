/**
 * SheetImportReview — the confirm/redact step of the agentic Sheets import. Pure view:
 * proposals in, callbacks out. Asserts the user can see the cleaned previews + the agent's SQL,
 * exclude tables, send feedback for a revision, and confirm only the included subset.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import SheetImportReview, { type SheetImportProposal } from '@/components/views/connection-configs/SheetImportReview';

const proposal = (name: string, included = true): SheetImportProposal => ({
  included,
  transform: {
    output_table: name,
    schema_name: 'public',
    source_tables: ['l1_consol'],
    sql: `SELECT B AS line_item FROM raw.l1_consol -- ${name}`,
    description: `Cleans ${name} from the P&L crosstab.`,
  },
  preview: {
    columns: [{ name: 'line_item', type: 'VARCHAR' }, { name: 'value', type: 'DOUBLE' }],
    rows: [{ line_item: 'Revenue', value: 13048 }, { line_item: 'COGS', value: -4553 }],
    row_count: 8,
  },
});

function setup(overrides: Partial<Parameters<typeof SheetImportReview>[0]> = {}) {
  const props = {
    proposals: [proposal('pnl_long'), proposal('zones_clean')],
    dropped: [],
    revising: false,
    confirming: false,
    onToggle: vi.fn(),
    onRevise: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  renderWithProviders(<SheetImportReview {...props} />);
  return props;
}

describe('SheetImportReview', () => {
  it('shows each proposed table with its cleaned preview values', () => {
    setup();
    expect(screen.getByLabelText('Preview of pnl_long')).toBeTruthy();
    expect(screen.getAllByText('-4553').length).toBeGreaterThan(0); // cleaned negative visible
    expect(screen.getByText('Cleans pnl_long from the P&L crosstab.')).toBeTruthy();
  });

  it('reveals the agent-authored SQL on demand', async () => {
    setup();
    await userEvent.click(screen.getByLabelText('Show SQL for pnl_long'));
    expect(screen.getByText(/SELECT B AS line_item FROM raw\.l1_consol -- pnl_long/)).toBeTruthy();
  });

  it('toggling a table reports the exclusion', async () => {
    const props = setup();
    await userEvent.click(screen.getByLabelText('Include table zones_clean'));
    expect(props.onToggle).toHaveBeenCalledWith('zones_clean');
  });

  it('the confirm button reflects the included count and fires onConfirm', async () => {
    const props = setup({ proposals: [proposal('pnl_long'), proposal('zones_clean', false)] });
    const confirm = screen.getByLabelText('Import 1 tables');
    await userEvent.click(confirm);
    expect(props.onConfirm).toHaveBeenCalled();
  });

  it('confirm is disabled when nothing is included', () => {
    setup({ proposals: [proposal('pnl_long', false)] });
    expect((screen.getByLabelText('Import 0 tables') as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends feedback to the agent and clears the box', async () => {
    const props = setup();
    const box = screen.getByLabelText('Feedback for the agent') as HTMLTextAreaElement;
    await userEvent.type(box, 'split margins into their own table');
    await userEvent.click(screen.getByLabelText('Revise with agent'));
    expect(props.onRevise).toHaveBeenCalledWith('split margins into their own table');
    expect(box.value).toBe('');
  });

  it('surfaces dropped (unrunnable) transforms as a warning', () => {
    setup({ dropped: ['- summary_tab: Binder Error'] });
    expect(screen.getByText(/could not be made runnable/)).toBeTruthy();
  });
});
