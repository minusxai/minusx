/**
 * StoryJsxBody — the `<Grid>`/`<GridItem>` story layout component.
 *
 * View mode is pure CSS (no react-grid-layout mounted): items carry the geometry as CSS
 * variables consumed by literal Tailwind classes, so captures serialize by construction.
 * Edit mode mounts react-grid-layout (drag + se-resize) with the structural CSS injected
 * inside the surface subtree, and a drag/resize commit is staged in the SAME edit session
 * as text/format edits (the no-clobber invariant), writing x/y/w/h back into the source
 * by AST path. Embeds inside a GridItem fill the cell — the cell is the single source of
 * height, so an authored embed height is ignored inside a grid.
 */
import React, { createRef } from 'react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

const h = vi.hoisted(() => ({
  smartProps: [] as Record<string, unknown>[],
}));

vi.mock('@/components/containers/SmartEmbeddedQuestionContainer', async () => {
  const React = await import('react');
  const Fake = (props: Record<string, unknown>) => {
    h.smartProps.push(props);
    return React.createElement('div', { 'aria-label': `Embedded question ${props.questionId}` });
  };
  return { __esModule: true, default: Fake };
});

import StoryJsxBody, { type StoryJsxEditApi } from '../StoryJsxBody';

// Paths: Grid=0 → GridItem 0.0 (p at 0.0.0), GridItem 0.1 (p at 0.1.0)
const GRID_DOC = [
  '<Grid>',
  '<GridItem x={0} y={0} w={8} h={5}><p>alpha</p></GridItem>',
  '<GridItem x={8} y={0} w={4} h={5}><p>beta</p></GridItem>',
  '</Grid>',
].join('');

beforeEach(() => {
  h.smartProps.length = 0;
});

function renderBody(overrides: Partial<React.ComponentProps<typeof StoryJsxBody>> = {}) {
  const editApiRef = createRef<StoryJsxEditApi | null>();
  const onChange = vi.fn<(story: string) => void>();
  const utils = renderWithProviders(
    <StoryJsxBody
      doc={document}
      jsx={GRID_DOC}
      readOnly={false}
      onChange={onChange}
      editApiRef={editApiRef}
      {...overrides}
    />,
  );
  const at = (path: string) => {
    const el = utils.container.querySelector(`[data-mx-ast="${path}"]`) as HTMLElement | null;
    if (!el) throw new Error(`no element at ast path ${path}`);
    return el;
  };
  return { ...utils, editApiRef, onChange, at };
}

describe('Grid — view mode (pure CSS, no react-grid-layout)', () => {
  it('renders items with the geometry as CSS variables and never mounts RGL', () => {
    const { container, at } = renderBody();
    expect(container.querySelector('.react-grid-layout')).toBeNull();
    expect(container.querySelector('.react-resizable-handle')).toBeNull();

    const grid = at('0');
    // Grid var contract: cols, row height, and total rows (max y+h = 5).
    expect(grid.style.getPropertyValue('--g-cols')).toBe('12');
    expect(grid.style.getPropertyValue('--g-rh')).toBe('86px');
    expect(grid.style.getPropertyValue('--g-rows')).toBe('5');

    const item = at('0.0');
    expect(item.style.getPropertyValue('--gi-x')).toBe('0');
    expect(item.style.getPropertyValue('--gi-y')).toBe('0');
    expect(item.style.getPropertyValue('--gi-w')).toBe('8');
    expect(item.style.getPropertyValue('--gi-h')).toBe('5');
    const second = at('0.1');
    expect(second.style.getPropertyValue('--gi-x')).toBe('8');

    // Content renders inside the items.
    expect(item.textContent).toContain('alpha');
    expect(second.textContent).toContain('beta');
  });

  it('applies the defaulting/clamping rule to bare and out-of-range items', () => {
    const { at } = renderBody({
      jsx: '<Grid cols={6}><GridItem><p>bare</p></GridItem><GridItem x={5} w={4} h={2}><p>pushed</p></GridItem></Grid>',
    });
    const bare = at('0.0');
    expect(bare.style.getPropertyValue('--gi-x')).toBe('0');
    expect(bare.style.getPropertyValue('--gi-w')).toBe('6');
    expect(bare.style.getPropertyValue('--gi-h')).toBe('4');
    // x clamped so the item stays inside the 6-col grid.
    const pushed = at('0.1');
    expect(pushed.style.getPropertyValue('--gi-x')).toBe('2');
    expect(at('0').style.getPropertyValue('--g-cols')).toBe('6');
  });

  it('drops non-GridItem children (whitespace text, stray elements) from the grid', () => {
    const { at, container } = renderBody({
      jsx: '<Grid>\n  <GridItem x={0} y={0} w={6} h={2}><p>kept</p></GridItem>\n  <p>stray</p>\n</Grid>',
    });
    expect(at('0').textContent).not.toContain('stray');
    expect(container.textContent).toContain('kept');
  });
});

describe('Grid — edit mode (react-grid-layout)', () => {
  it('mounts RGL with drag + se-resize and injects the structural CSS inside the subtree', () => {
    const { container } = renderBody({ editable: true });
    expect(container.querySelector('.react-grid-layout')).not.toBeNull();
    expect(container.querySelector('.react-resizable-handle-se')).not.toBeNull();
    const style = container.querySelector('style[data-mx-grid-css]');
    expect(style).not.toBeNull();
    expect(style!.textContent).toContain('.react-grid-item');
    // Item content still renders, stamped with its AST path.
    const item = container.querySelector('[data-mx-ast="0.0"]') as HTMLElement;
    expect(item.textContent).toContain('alpha');
  });

  it('does NOT mount RGL when the body is read-only', () => {
    const { container } = renderBody({ editable: true, readOnly: true });
    expect(container.querySelector('.react-grid-layout')).toBeNull();
  });
});

describe('Grid — layout commits in the edit session', () => {
  it('applyLayoutEdit writes x/y/w/h into the source and fires onChange immediately', () => {
    const { editApiRef, onChange } = renderBody({ editable: true });
    editApiRef.current!.applyLayoutEdit([{ astPath: '0.0', x: 4, y: 2, w: 6, h: 3 }]);
    expect(onChange).toHaveBeenLastCalledWith(
      '<Grid><GridItem x={4} y={2} w={6} h={3}><p>alpha</p></GridItem><GridItem x={8} y={0} w={4} h={5}><p>beta</p></GridItem></Grid>',
    );
  });

  it('a multi-item commit (compaction) lands atomically', () => {
    const { editApiRef, onChange } = renderBody({ editable: true });
    editApiRef.current!.applyLayoutEdit([
      { astPath: '0.0', x: 0, y: 4, w: 8, h: 5 },
      { astPath: '0.1', x: 0, y: 0, w: 12, h: 4 },
    ]);
    expect(onChange).toHaveBeenLastCalledWith(
      '<Grid><GridItem x={0} y={4} w={8} h={5}><p>alpha</p></GridItem><GridItem x={0} y={0} w={12} h={4}><p>beta</p></GridItem></Grid>',
    );
  });

  it('no-clobber: a layout commit composes with a staged format edit, and serialize() has both', () => {
    const { editApiRef, onChange } = renderBody({ editable: true });
    editApiRef.current!.applyFormatEdit('0.0.0', { className: 'text-2xl' });
    editApiRef.current!.applyLayoutEdit([{ astPath: '0.0', x: 1, y: 1, w: 7, h: 4 }]);
    const expected =
      '<Grid><GridItem x={1} y={1} w={7} h={4}><p className="text-2xl">alpha</p></GridItem><GridItem x={8} y={0} w={4} h={5}><p>beta</p></GridItem></Grid>';
    expect(onChange).toHaveBeenLastCalledWith(expected);
    expect(editApiRef.current!.serialize()).toBe(expected);
  });

  it('a stale path commits nothing and never corrupts the source', () => {
    const { editApiRef, onChange } = renderBody({ editable: true });
    editApiRef.current!.applyLayoutEdit([{ astPath: '0.9', x: 1, y: 1, w: 1, h: 1 }]);
    // Nothing changed → no onChange (an echo would mark the file dirty on open).
    expect(onChange).not.toHaveBeenCalled();
    expect(editApiRef.current!.serialize()).toBeNull();
  });
});

describe('GridItem — embeds fill the cell', () => {
  it('a <Question> inside a GridItem renders at 100% height, ignoring an authored height', () => {
    const { container } = renderBody({
      jsx: '<Grid><GridItem x={0} y={0} w={6} h={5}><Question id={42} height="420px" /></GridItem></Grid>',
    });
    const embed = container.querySelector('[aria-label="Question embed"]') as HTMLElement;
    expect(embed).not.toBeNull();
    expect(embed.style.height).toBe('100%');
  });

  it('the same <Question> outside a Grid keeps its authored px height', () => {
    const { container } = renderBody({ jsx: '<div><Question id={42} height="420px" /></div>' });
    const embed = container.querySelector('[aria-label="Question embed"]') as HTMLElement;
    expect(embed.style.height).toBe('420px');
  });
});
