/**
 * `applyLayoutEditsToJsx` — the story grid's drag/resize commit path: set x/y/w/h on the
 * `<GridItem>` elements at the given AST paths, one parse/serialize per batch, skipping
 * stale/hostile paths and non-GridItem targets so a bad path can never corrupt a body.
 */
import { describe, it, expect } from 'vitest';

import { applyLayoutEditsToJsx, applyFormatEditsToJsx } from '@/lib/data/story/jsx-edit';
import { parseJsx, validateJsxSource, type JsxElement } from '@/lib/jsx';
import { JSX_STORY_COMPONENT_NAMES } from '@/lib/jsx/components';
import { STORY_HTML_TAGS } from '@/lib/story-ui/component-names';

const GRID_SRC = [
  '<Grid>',
  '<GridItem x={0} y={0} w={8} h={5}><p>alpha</p></GridItem>',
  '<GridItem x={8} y={0} w={4} h={5}><p>beta</p></GridItem>',
  '</Grid>',
].join('');

/** attrs of the GridItem at child index `i` of the root Grid (index counts ALL nodes). */
function itemAttrs(source: string, i: number): Record<string, unknown> {
  const parsed = parseJsx(source);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error('unreachable');
  const grid = parsed.nodes[0] as JsxElement;
  const item = grid.children[i] as JsxElement;
  expect(item.tag).toBe('GridItem');
  const out: Record<string, unknown> = {};
  for (const a of item.attributes) if (a.value.static) out[a.name] = a.value.json;
  return out;
}

describe('applyLayoutEditsToJsx', () => {
  it('sets x/y/w/h on the GridItem at the path, leaving everything else byte-identical', () => {
    const next = applyLayoutEditsToJsx(GRID_SRC, [{ astPath: '0.0', x: 4, y: 2, w: 6, h: 3 }]);
    expect(itemAttrs(next, 0)).toEqual({ x: 4, y: 2, w: 6, h: 3 });
    // The sibling and the children are untouched.
    expect(itemAttrs(next, 1)).toEqual({ x: 8, y: 0, w: 4, h: 5 });
    expect(next).toContain('<p>alpha</p>');
    expect(next).toContain('<p>beta</p>');
    // The result is valid, renderable story JSX.
    expect(validateJsxSource(next, JSX_STORY_COMPONENT_NAMES, STORY_HTML_TAGS)).toEqual([]);
  });

  it('commits a multi-item batch (vertical compaction moves siblings) in one pass', () => {
    const next = applyLayoutEditsToJsx(GRID_SRC, [
      { astPath: '0.0', x: 0, y: 5, w: 8, h: 5 },
      { astPath: '0.1', x: 0, y: 0, w: 12, h: 5 },
    ]);
    expect(itemAttrs(next, 0)).toEqual({ x: 0, y: 5, w: 8, h: 5 });
    expect(itemAttrs(next, 1)).toEqual({ x: 0, y: 0, w: 12, h: 5 });
  });

  it('adds missing rect attributes to a GridItem that authored none', () => {
    const src = '<Grid><GridItem><p>bare</p></GridItem></Grid>';
    const next = applyLayoutEditsToJsx(src, [{ astPath: '0.0', x: 2, y: 1, w: 5, h: 2 }]);
    expect(itemAttrs(next, 0)).toEqual({ x: 2, y: 1, w: 5, h: 2 });
  });

  it('returns source unchanged for a stale path', () => {
    expect(applyLayoutEditsToJsx(GRID_SRC, [{ astPath: '0.9', x: 1, y: 1, w: 1, h: 1 }])).toBe(GRID_SRC);
  });

  it('returns source unchanged when the path resolves to a non-GridItem', () => {
    // '0' is the Grid itself; '0.0.0' is the <p> inside the first item.
    expect(applyLayoutEditsToJsx(GRID_SRC, [{ astPath: '0', x: 1, y: 1, w: 1, h: 1 }])).toBe(GRID_SRC);
    expect(applyLayoutEditsToJsx(GRID_SRC, [{ astPath: '0.0.0', x: 1, y: 1, w: 1, h: 1 }])).toBe(GRID_SRC);
  });

  it('applies resolvable edits and skips stale ones within one batch', () => {
    const next = applyLayoutEditsToJsx(GRID_SRC, [
      { astPath: '0.9', x: 9, y: 9, w: 9, h: 9 },
      { astPath: '0.1', x: 0, y: 5, w: 12, h: 4 },
    ]);
    expect(itemAttrs(next, 0)).toEqual({ x: 0, y: 0, w: 8, h: 5 });
    expect(itemAttrs(next, 1)).toEqual({ x: 0, y: 5, w: 12, h: 4 });
  });

  it('returns source unchanged on an empty batch and on unparseable source', () => {
    expect(applyLayoutEditsToJsx(GRID_SRC, [])).toBe(GRID_SRC);
    const bad = '<Grid><GridItem</Grid>';
    expect(applyLayoutEditsToJsx(bad, [{ astPath: '0.0', x: 0, y: 0, w: 1, h: 1 }])).toBe(bad);
  });

  it('composes after a format edit — paths stay stable across attribute-only edits', () => {
    const formatted = applyFormatEditsToJsx(GRID_SRC.replace('<p>alpha</p>', '<p className="text-sm">alpha</p>'), [
      { astPath: '0.0.0', className: 'text-lg' },
    ]);
    const next = applyLayoutEditsToJsx(formatted, [{ astPath: '0.0', x: 1, y: 1, w: 7, h: 4 }]);
    expect(itemAttrs(next, 0)).toEqual({ x: 1, y: 1, w: 7, h: 4 });
    expect(next).toContain('className="text-lg"');
  });
});
