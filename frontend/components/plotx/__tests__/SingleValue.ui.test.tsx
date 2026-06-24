// SingleValue component wiring: config decorates the live number; empty label hides the label row.
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { SingleValue } from '../SingleValue';

describe('SingleValue — config wiring', () => {
  it('renders the live number decorated with prefix/suffix and the override label', () => {
    renderWithProviders(<SingleValue values={[{ name: 'mrr', value: 50000 }]} config={{ label: 'Monthly Recurring Revenue', prefix: '$', suffix: ' MRR' }} />);
    expect(screen.getByLabelText('single value mrr').textContent).toBe('$50k MRR');
    expect(screen.getByText('Monthly Recurring Revenue')).toBeTruthy();
  });

  it('hides the label row when the agent overrides label to an empty string', () => {
    renderWithProviders(<SingleValue values={[{ name: 'arr', value: 12 }]} config={{ label: '', suffix: '%' }} />);
    expect(screen.getByLabelText('single value arr').textContent).toBe('12%');
    expect(screen.queryByText('arr')).toBeNull();
  });

  it('falls back to the column name and undecorated number with no config', () => {
    renderWithProviders(<SingleValue values={[{ name: 'count', value: 1234567 }]} />);
    expect(screen.getByLabelText('single value count').textContent).toBe('1.23M');
    expect(screen.getByText('count')).toBeTruthy();
  });
});
