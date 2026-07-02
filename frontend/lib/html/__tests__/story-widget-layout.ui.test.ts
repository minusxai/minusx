/**
 * Flow-block layout contract for resizable/movable story widgets.
 *
 * A widget is freely resizable in px on BOTH axes only when it's a plain flow block: nothing between
 * it and the story root may govern its width via a track/cell (grid / flex / table), and the widget
 * itself must carry an explicit px width+height (so a resize is a real value that serialize can
 * round-trip). This validator flags every violation so the render layer can warn/repair and tests can
 * assert the contract. Pure ancestor-walk over computed `display` (jsdom resolves inline `display`),
 * so it lives in a `.ui.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { findWidgetLayoutViolations } from '../story-widget-layout';

/** Build canvas → [ancestors with given inline display] → widget(px size), return {canvas, widget}. */
function build(ancestorDisplays: string[], widgetStyle = 'width:640px;height:400px') {
  const canvas = document.createElement('div');
  canvas.setAttribute('data-mx-canvas', '');
  let parent: HTMLElement = canvas;
  for (const display of ancestorDisplays) {
    const a = document.createElement('div');
    if (display) a.setAttribute('style', `display:${display}`);
    parent.appendChild(a);
    parent = a;
  }
  const widget = document.createElement('div');
  widget.setAttribute('data-question-id', '1');
  widget.setAttribute('style', widgetStyle);
  parent.appendChild(widget);
  document.body.appendChild(canvas);
  return { canvas, widget };
}

describe('findWidgetLayoutViolations', () => {
  it('a plain flow block with px width+height has no violations', () => {
    const { canvas, widget } = build(['block', 'block']);
    expect(findWidgetLayoutViolations(widget, canvas)).toEqual([]);
  });

  it('flags a grid ancestor (width governed by the column track)', () => {
    const { canvas, widget } = build(['grid']);
    const v = findWidgetLayoutViolations(widget, canvas);
    expect(v).toContainEqual(expect.objectContaining({ kind: 'packed-ancestor', display: 'grid' }));
  });

  it('flags a flex ancestor', () => {
    const { canvas, widget } = build(['flex']);
    expect(findWidgetLayoutViolations(widget, canvas)).toContainEqual(
      expect.objectContaining({ kind: 'packed-ancestor', display: 'flex' }),
    );
  });

  it('flags a table ancestor', () => {
    const { canvas, widget } = build(['table']);
    expect(findWidgetLayoutViolations(widget, canvas)).toContainEqual(
      expect.objectContaining({ kind: 'packed-ancestor', display: 'table' }),
    );
  });

  it('accepts width:100% — the responsive flow-block default is still freely resizable', () => {
    const { canvas, widget } = build(['block'], 'width:100%;height:400px');
    expect(findWidgetLayoutViolations(widget, canvas)).toEqual([]);
  });

  it('flags an unusable width (auto / non-100% percentage) that is neither px nor full-width', () => {
    const { canvas, widget } = build(['block'], 'width:50%;height:400px');
    expect(findWidgetLayoutViolations(widget, canvas)).toContainEqual(
      expect.objectContaining({ kind: 'non-px-width' }),
    );
  });

  it('flags a missing/auto height', () => {
    const { canvas, widget } = build(['block'], 'width:640px');
    expect(findWidgetLayoutViolations(widget, canvas)).toContainEqual(
      expect.objectContaining({ kind: 'non-px-height' }),
    );
  });

  it('does NOT look past the canvas boundary — a grid ANCESTOR of the canvas is ignored', () => {
    const { canvas, widget } = build(['block']);
    const outerGrid = document.createElement('div');
    outerGrid.setAttribute('style', 'display:grid');
    document.body.appendChild(outerGrid);
    outerGrid.appendChild(canvas);
    expect(findWidgetLayoutViolations(widget, canvas)).toEqual([]);
  });

  it('reports every violation together (grid ancestor + unusable width)', () => {
    const { canvas, widget } = build(['grid'], 'width:50%;height:400px');
    const kinds = findWidgetLayoutViolations(widget, canvas).map(x => x.kind).sort();
    expect(kinds).toEqual(['non-px-width', 'packed-ancestor']);
  });
});
