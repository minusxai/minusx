// single_value display resolution: the number stays LIVE (from the query); config only decorates.
import { describe, it, expect } from 'vitest';
import { resolveSingleValueDisplay } from '../single-value';

describe('resolveSingleValueDisplay — no config', () => {
  it('uses the column name as label and the formatted live value', () => {
    const d = resolveSingleValueDisplay({ name: 'MRR', value: 1234567 });
    expect(d.label).toBe('MRR');
    expect(d.text).toBe('1.23M'); // formatLargeNumber
    expect(d.align).toBe('center');
    expect(d.valueStyle).toEqual({});
    expect(d.labelStyle).toEqual({});
  });

  it('renders an em-dash for null without prefix/suffix', () => {
    const d = resolveSingleValueDisplay({ name: 'x', value: null });
    expect(d.text).toBe('—');
  });

  it('passes through non-numeric string values verbatim', () => {
    expect(resolveSingleValueDisplay({ name: 'status', value: 'Healthy' }).text).toBe('Healthy');
  });
});

describe('resolveSingleValueDisplay — with config (decoration only)', () => {
  it('applies label override, prefix and suffix around the live number', () => {
    const d = resolveSingleValueDisplay(
      { name: 'mrr', value: 50000 },
      { label: 'Monthly Recurring Revenue', prefix: '$', suffix: ' MRR' },
    );
    expect(d.label).toBe('Monthly Recurring Revenue');
    expect(d.text).toBe('$50k MRR');
  });

  it('does NOT decorate a null value with prefix/suffix', () => {
    const d = resolveSingleValueDisplay({ name: 'x', value: null }, { prefix: '$', suffix: '%' });
    expect(d.text).toBe('—');
  });

  it('maps typography props to value/label styles and alignment', () => {
    const d = resolveSingleValueDisplay(
      { name: 'growth', value: 12 },
      { valueSize: '5rem', valueColor: '#16a34a', valueWeight: 900, labelColor: '#64748b', align: 'left', suffix: '%' },
    );
    expect(d.text).toBe('12%');
    expect(d.valueStyle).toEqual({ fontSize: '5rem', color: '#16a34a', fontWeight: 900 });
    expect(d.labelStyle).toEqual({ color: '#64748b' });
    expect(d.align).toBe('left');
  });

  it('empty-string label hides the label (label override wins over name)', () => {
    expect(resolveSingleValueDisplay({ name: 'mrr', value: 1 }, { label: '' }).label).toBe('');
  });

  it('treats null config fields as absent', () => {
    const d = resolveSingleValueDisplay(
      { name: 'mrr', value: 100 },
      { label: null, prefix: null, suffix: null, valueSize: null, valueColor: null, valueWeight: null, labelColor: null, align: null },
    );
    expect(d.label).toBe('mrr');
    expect(d.text).toBe('100');
    expect(d.valueStyle).toEqual({});
    expect(d.align).toBe('center');
  });
});
