/**
 * Saved-embed styles codec — `<Question id={N} styles={{…}}/>` rides a `data-question-styles`
 * JSON attribute on the placeholder div. The codec picks ONLY the presentation subset
 * (EmbedVizStyles): a styles prop can restyle the chart but never change what it plots.
 */
import { describe, it, expect } from 'vitest';
import {
  EMBED_STYLE_KEYS,
  embedStylesFromJsxAttr,
  embedStylesToAttr,
  embedStylesFromEl,
} from '../story-embed-styles';
import { unescAttr } from '../html-attr';

describe('embedStylesFromJsxAttr', () => {
  it('picks only presentation keys, dropping type/columns/query', () => {
    const parsed = embedStylesFromJsxAttr({
      styleConfig: { background: '#101822', textColor: '#f7f0df' },
      axisConfig: { yMin: 0 },
      singleValueConfig: { valueColor: '#e8a33d' },
      type: 'pie',
      xCols: ['hacked'],
      query: 'SELECT 1',
    });
    expect(parsed).toEqual({
      styleConfig: { background: '#101822', textColor: '#f7f0df' },
      axisConfig: { yMin: 0 },
      singleValueConfig: { valueColor: '#e8a33d' },
    });
  });

  it('returns null for non-objects, arrays, and objects with no presentation keys', () => {
    expect(embedStylesFromJsxAttr(null)).toBeNull();
    expect(embedStylesFromJsxAttr('styles')).toBeNull();
    expect(embedStylesFromJsxAttr([{ styleConfig: {} }])).toBeNull();
    expect(embedStylesFromJsxAttr({ type: 'pie' })).toBeNull();
  });
});

describe('attr round-trip', () => {
  const styles = {
    styleConfig: { background: '#101822', echartsOverrides: { grid: { left: 8 } } },
    columnFormats: { revenue: { prefix: '$' } },
  };

  it('serializes entity-escaped and parses back (regex-extracted path)', () => {
    const attr = embedStylesToAttr(styles);
    expect(attr).not.toContain('"'); // entity-escaped for placement inside an HTML attribute
    expect(JSON.parse(unescAttr(attr))).toEqual(styles);
  });

  it('parses from a DOM element (already entity-decoded getAttribute path)', () => {
    const el = { getAttribute: (n: string) => (n === 'data-question-styles' ? JSON.stringify(styles) : null) };
    expect(embedStylesFromEl(el)).toEqual(styles);
  });

  it('tolerates malformed and missing attributes (→ null, embed still renders unstyled)', () => {
    expect(embedStylesFromEl({ getAttribute: () => '{not json' })).toBeNull();
    expect(embedStylesFromEl({ getAttribute: () => null })).toBeNull();
  });

  it('drops non-presentation keys smuggled into the stored attribute', () => {
    const el = {
      getAttribute: () => JSON.stringify({ styleConfig: { background: '#000' }, type: 'pie' }),
    };
    expect(embedStylesFromEl(el)).toEqual({ styleConfig: { background: '#000' } });
  });
});

describe('EMBED_STYLE_KEYS', () => {
  it('is exactly the presentation-only subset', () => {
    expect([...EMBED_STYLE_KEYS].sort()).toEqual(
      ['axisConfig', 'columnFormats', 'conditionalFormats', 'singleValueConfig', 'styleConfig'],
    );
  });
});
