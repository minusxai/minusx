vi.unmock('react-markdown');
vi.unmock('remark-gfm');

import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import Markdown from '@/components/Markdown/index';

describe('Markdown internal file link chips', () => {
  it('keeps long labels on one line and truncates overflow', () => {
    const label = 'question: Revenue by Platform - Last Month';

    renderWithProviders(<Markdown context="sidebar">{`[${label}](/f/17)`}</Markdown>);

    const link = screen.getByRole('link', { name: label });
    const labelElement = link.lastElementChild;

    expect(link).toHaveStyle({
      maxWidth: '100%',
      minWidth: '0',
      overflow: 'hidden',
      whiteSpace: 'nowrap',
    });
    expect(labelElement).toHaveStyle({
      minWidth: '0',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    });
  });
});
