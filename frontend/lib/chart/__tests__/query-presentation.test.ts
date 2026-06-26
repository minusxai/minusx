// The pure ReadFiles/ExecuteQuery presentation decision: image for server-renderable viz (default),
// rows otherwise or when rawData is explicitly requested.
import { describe, it, expect } from 'vitest';
import { queryPresentation } from '../query-presentation';

describe('queryPresentation', () => {
  it('returns image for a server-renderable chart viz by default', () => {
    for (const t of ['line', 'bar', 'area', 'scatter', 'pie', 'funnel', 'combo']) {
      expect(queryPresentation(t, false)).toBe('image');
    }
  });

  it('returns data for non-renderable viz (table/pivot/single_value/number/trend)', () => {
    for (const t of ['table', 'pivot', 'single_value', 'number', 'trend', 'heatmap']) {
      expect(queryPresentation(t, false)).toBe('data');
    }
  });

  it('returns data when there is no viz at all', () => {
    expect(queryPresentation(undefined, false)).toBe('data');
  });

  it('always returns data when rawData is true, even for a renderable viz', () => {
    expect(queryPresentation('bar', true)).toBe('data');
    expect(queryPresentation('line', true)).toBe('data');
  });

  it('treats undefined rawData as the default (false)', () => {
    expect(queryPresentation('bar', undefined)).toBe('image');
    expect(queryPresentation('table', undefined)).toBe('data');
  });
});
