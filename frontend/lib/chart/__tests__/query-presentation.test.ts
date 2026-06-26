// The pure ReadFiles/ExecuteQuery presentation decision: image for server-renderable viz (default),
// rows otherwise or when rawData is explicitly requested.
import { describe, it, expect } from 'vitest';
import { queryPresentation, shouldDropRows } from '../query-presentation';

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

describe('shouldDropRows', () => {
  it('keeps rows when the result is presented as data (table / rawData)', () => {
    expect(shouldDropRows({ imagePresentation: false, imageRendered: true })).toBe(false);
    expect(shouldDropRows({ imagePresentation: false, imageRendered: false })).toBe(false);
  });

  it('drops rows when an image was actually rendered (the image conveys the result)', () => {
    expect(shouldDropRows({ imagePresentation: true, imageRendered: true })).toBe(true);
  });

  it('KEEPS rows when image presentation is wanted but NO image rendered — never blind the agent', () => {
    // The bug: stripping rows on `queryPresentation === image` alone left the agent with neither an
    // image (render failed / no rows / server-side / param-keying miss) nor data.
    expect(shouldDropRows({ imagePresentation: true, imageRendered: false })).toBe(false);
    expect(shouldDropRows({ imagePresentation: true, imageRendered: false, resultUnchanged: false })).toBe(false);
  });

  it('drops rows for an UNCHANGED image-presented result even without a fresh image (already sent)', () => {
    // EditFile re-render is skipped when the result is unchanged; the chart image was already sent in
    // app state / a prior turn, and the projection dedups rows — so dropping is safe.
    expect(shouldDropRows({ imagePresentation: true, imageRendered: false, resultUnchanged: true })).toBe(true);
  });
});
