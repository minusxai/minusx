/**
 * MentionSubmenu — the column drill-down panel for the table highlighted in
 * the @ mention dropdown. Columns-only (metric drill-down was removed in favor
 * of metrics defined in context docs / the semantic layer).
 *
 * Queries use aria-labels only, per repo convention.
 */

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import type { MentionItem } from '@/lib/data/completions/types';
import { MentionSubmenu } from '@/components/lexical/MentionSubmenu';

const TABLE: MentionItem = {
  name: 'orders',
  schema: 'main',
  connection: 'mxfood',
  type: 'table',
  display_text: 'orders',
  insert_text: 'orders',
};

const COLUMNS = [
  { name: 'id', type: 'integer' },
  { name: 'customer', type: 'varchar' },
];

describe('MentionSubmenu', () => {
  it('renders one row per column', async () => {
    renderWithProviders(
      <MentionSubmenu
        table={TABLE}
        items={COLUMNS}
        inSubmenu={false}
        columnIndex={0}
        onHoverItem={() => {}}
        onSelectItem={() => {}}
      />,
    );
    expect(await screen.findByLabelText('Insert column id')).toBeInTheDocument();
    expect(await screen.findByLabelText('Insert column customer')).toBeInTheDocument();
  });

  it('calls onSelectItem with the clicked column', async () => {
    const onSelectItem = vi.fn();
    renderWithProviders(
      <MentionSubmenu
        table={TABLE}
        items={COLUMNS}
        inSubmenu={false}
        columnIndex={0}
        onHoverItem={() => {}}
        onSelectItem={onSelectItem}
      />,
    );
    await userEvent.click(await screen.findByLabelText('Insert column customer'));
    expect(onSelectItem).toHaveBeenCalledWith({ name: 'customer', type: 'varchar' });
  });
});
