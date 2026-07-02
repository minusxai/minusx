/**
 * Reorder-in-flow move for story widgets.
 *
 * "Move" is reordering a widget among its flow siblings (stories are a flow document — there's no x/y
 * canvas). `computeDropIndex` maps a pointer Y to the insertion slot (how many blocks sit above the
 * pointer's position by their vertical midpoint); `reorderBlock` moves the dragged node to that slot in
 * the real DOM. serialize-story clones child nodes in DOM order, so a reorder persists for free — the
 * round-trip test proves it.
 */
import { describe, it, expect } from 'vitest';
import { computeDropIndex, reorderBlock, movableSiblings } from '../story-reorder';
import { serializeEditedStory } from '../serialize-story';

describe('computeDropIndex', () => {
  // three stacked blocks: [0..100], [100..200], [200..300] → midpoints 50/150/250
  const rects = [
    { top: 0, bottom: 100 },
    { top: 100, bottom: 200 },
    { top: 200, bottom: 300 },
  ];
  it('pointer above every block → slot 0', () => expect(computeDropIndex(rects, -10)).toBe(0));
  it('pointer past every midpoint → last slot', () => expect(computeDropIndex(rects, 999)).toBe(3));
  it('pointer just past the first midpoint → slot 1', () => expect(computeDropIndex(rects, 60)).toBe(1));
  it('pointer just past the second midpoint → slot 2', () => expect(computeDropIndex(rects, 160)).toBe(2));
  it('empty list → slot 0', () => expect(computeDropIndex([], 100)).toBe(0));
});

describe('reorderBlock', () => {
  function make() {
    const parent = document.createElement('div');
    const els = ['a', 'b', 'c'].map(id => {
      const el = document.createElement('div');
      el.setAttribute('data-id', id);
      parent.appendChild(el);
      return el;
    });
    return { parent, els };
  }
  const order = (parent: HTMLElement) =>
    [...parent.children].map(el => el.getAttribute('data-id')).join('');

  it('moves the first block to the end', () => {
    const { parent, els } = make();
    const idx = reorderBlock(els[0], els, 2);
    expect(order(parent)).toBe('bca');
    expect(idx).toBe(2);
  });

  it('moves the last block to the front', () => {
    const { parent, els } = make();
    reorderBlock(els[2], els, 0);
    expect(order(parent)).toBe('cab');
  });

  it('moves a middle block up', () => {
    const { parent, els } = make();
    reorderBlock(els[1], els, 0);
    expect(order(parent)).toBe('bac');
  });

  it('dropping a block at its own slot is a no-op', () => {
    const { parent, els } = make();
    reorderBlock(els[1], els, 1);
    expect(order(parent)).toBe('abc');
  });

  it('clamps an out-of-range index to the end', () => {
    const { parent, els } = make();
    reorderBlock(els[0], els, 99);
    expect(order(parent)).toBe('bca');
  });
});

describe('movableSiblings', () => {
  it('returns the widget’s flow siblings, excluding style / embed-root / drop-indicator', () => {
    const parent = document.createElement('div');
    const style = document.createElement('style'); parent.appendChild(style);
    const a = document.createElement('div'); a.setAttribute('data-question-id', '1'); parent.appendChild(a);
    const text = document.createElement('p'); parent.appendChild(text);
    const b = document.createElement('div'); b.setAttribute('data-question-id', '2'); parent.appendChild(b);
    const embedRoot = document.createElement('div'); embedRoot.setAttribute('data-mx-embed-root', ''); parent.appendChild(embedRoot);
    const indicator = document.createElement('div'); indicator.setAttribute('data-mx-drop-indicator', ''); parent.appendChild(indicator);
    expect(movableSiblings(a)).toEqual([a, text, b]);
  });

  it('returns [] when the widget has no parent', () => {
    expect(movableSiblings(document.createElement('div'))).toEqual([]);
  });
});

describe('reorder → serialize round-trip', () => {
  it('the saved story reflects the new widget order', () => {
    const root = document.createElement('div');
    const mk = (qid: string) => {
      const el = document.createElement('div');
      el.setAttribute('data-question-id', qid);
      el.setAttribute('style', 'width:640px;height:400px');
      el.setAttribute('data-mx-osz', 'width:640px;height:400px');
      root.appendChild(el);
      return el;
    };
    const first = mk('11'); mk('22'); mk('33');
    reorderBlock(first, [...root.children] as HTMLElement[], 2); // 11 → end
    const out = serializeEditedStory(root, []);
    // order in serialized HTML should now be 22, 33, 11
    expect(out.indexOf('data-question-id="22"')).toBeLessThan(out.indexOf('data-question-id="33"'));
    expect(out.indexOf('data-question-id="33"')).toBeLessThan(out.indexOf('data-question-id="11"'));
  });
});
