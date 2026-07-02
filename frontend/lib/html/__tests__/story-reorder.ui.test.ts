/**
 * Document-wide reorder-in-flow move for story widgets.
 *
 * Stories are a flow document (no x/y canvas), so "move" is reordering a widget within the flow — but
 * NOT restricted to its immediate parent. `movableUnit` finds the whole CARD to move (the tight wrapper
 * grouping the chart with its caption, not the bare embed); `collectDropSlots` enumerates every flow gap
 * across the whole document (excluding gaps inside packed grid/flex/table containers — dropping there
 * would re-break the widget's px-resize contract — and gaps inside the dragged unit itself);
 * `chooseDropSlot` maps a pointer Y to the nearest gap; `applyDrop` splices the card into it.
 * serialize-story clones child nodes in DOM order, so a move persists for free — the round-trip test
 * proves it. Pure DOM walk (jsdom resolves inline `display`), geometry injected — so it lives here.
 */
import { describe, it, expect } from 'vitest';
import {
  storyCanvas,
  movableUnit,
  collectDropSlots,
  chooseDropSlot,
  applyDrop,
  type DropSlot,
} from '../story-reorder';
import { findWidgetLayoutViolations } from '../story-widget-layout';
import { serializeEditedStory } from '../serialize-story';

/** Attach an injectable rect to an element (top/bottom/left/width) for the geometry-dependent helpers. */
const rects = new WeakMap<Element, { top: number; bottom: number; left: number; width: number }>();
function withRect<T extends HTMLElement>(el: T, top: number, height: number, left = 0, width = 600): T {
  rects.set(el, { top, bottom: top + height, left, width });
  return el;
}
const getRect = (el: Element) => rects.get(el) ?? { top: 0, bottom: 0, left: 0, width: 0 };
/** jsdom getComputedStyle().display is empty for most nodes; read the inline `display` instead. */
const getStyle = (el: Element) => ({ display: (el as HTMLElement).style.display || 'block' }) as CSSStyleDeclaration;

function el(tag: string, attrs: Record<string, string> = {}, ...kids: HTMLElement[]): HTMLElement {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  kids.forEach(k => n.appendChild(k));
  return n;
}
const embed = (id: string) => el('div', { 'data-question-id': id, style: 'width:100%;height:400px' });

describe('storyCanvas — the story root, not the iframe body', () => {
  it('climbs from the embed to the single wrapper that is a direct child of <body>', () => {
    const chart = embed('1');
    const plate = el('div', { class: 'plate' }, chart);
    const section = el('section', {}, plate);
    const wrapper = el('div', {}, section); // the one story-root div AgentHtml writes under <body>
    document.body.appendChild(wrapper);
    // <body> also holds portaled popovers + scaffolding that must NOT become the canvas.
    document.body.appendChild(el('div', { class: 'chakra-popover__positioner' }));
    try {
      expect(storyCanvas(chart)).toBe(wrapper);
    } finally {
      document.body.replaceChildren();
    }
  });

  it('returns the element itself when it is already a direct child of <body>', () => {
    const root = embed('1');
    document.body.appendChild(root);
    try {
      expect(storyCanvas(root)).toBe(root);
    } finally {
      document.body.replaceChildren();
    }
  });
});

describe('movableUnit — climbs from the embed to the whole card', () => {
  it('climbs to the tight wrapper (caption + chart), stopping below a prose section', () => {
    const chart = embed('1');
    const plate = el('div', { class: 'plate' }, el('div', { class: 'caption' }), chart);
    const section = el('section', {}, el('p', {}), plate);
    const canvas = el('div', {}, section);
    expect(movableUnit(chart, canvas, getStyle)).toBe(plate);
  });

  it('returns the bare embed when it has no wrapper (direct child of the canvas)', () => {
    const chart = embed('1');
    const canvas = el('div', {}, chart);
    expect(movableUnit(chart, canvas, getStyle)).toBe(chart);
  });

  it('does not merge two charts: stops when a wrapper holds a second embed', () => {
    const chart = embed('1');
    const pair = el('div', {}, chart, embed('2')); // two embeds → not a single card
    const canvas = el('div', {}, pair);
    expect(movableUnit(chart, canvas, getStyle)).toBe(chart);
  });

  it('climbs through a chart-only section that carries no prose', () => {
    const chart = embed('1');
    const plate = el('div', { class: 'plate' }, el('div', { class: 'caption' }), chart);
    const section = el('section', {}, plate); // no <p> → whole section is the card
    const canvas = el('div', {}, section);
    expect(movableUnit(chart, canvas, getStyle)).toBe(section);
  });

  it('never climbs into a packed (grid/flex) ancestor', () => {
    const chart = embed('1');
    const grid = el('div', { style: 'display:grid' }, chart);
    const canvas = el('div', {}, grid);
    expect(movableUnit(chart, canvas, getStyle)).toBe(chart);
  });

  it('stops below a narrative beat authored in <div>s (real stories tag prose as divs, not <p>)', () => {
    const chart = embed('1');
    const caption = el('div', { class: 'caption' });
    caption.textContent = 'New vs Returning Users';
    const plate = el('div', { class: 'plate' }, caption, chart);
    const kicker = el('div', { class: 'kicker' });
    kicker.textContent = 'Beat 3 · habits';
    const narrative = el('div', { class: 'prose' });
    narrative.textContent =
      'This is a returning audience, not a one-touch crowd; volume rises and falls but the base keeps coming back.';
    const section = el('section', {}, kicker, narrative, plate);
    const canvas = el('div', {}, section);
    // Only the chart card moves — the beat's heading + narrative stay put.
    expect(movableUnit(chart, canvas, getStyle)).toBe(plate);
  });

  it('keeps a short <div> caption with the card (a title label is chrome, not narrative)', () => {
    const chart = embed('1');
    const caption = el('div', { class: 'caption' });
    caption.textContent = 'Signups by week';
    const plate = el('div', { class: 'plate' }, caption, chart);
    const canvas = el('div', {}, plate);
    expect(movableUnit(chart, canvas, getStyle)).toBe(plate);
  });
});

/** A canvas: section[ p, plate[caption, chart1] ], kpis(grid)[num, num], section2[ plate2[chart2] ]. */
function buildDoc() {
  const chart1 = withRect(embed('1'), 100, 400);
  const caption = withRect(el('div', { class: 'caption' }), 80, 20);
  const plate = withRect(el('div', { class: 'plate' }, caption, chart1), 80, 420);
  const prose = withRect(el('p', {}), 20, 40);
  const section = withRect(el('section', {}, prose, plate), 10, 500);

  const numA = withRect(el('div', { 'data-number-inline': '{}' }), 520, 60);
  const numB = withRect(el('div', { 'data-number-inline': '{}' }), 520, 60);
  const kpis = withRect(el('div', { style: 'display:grid' }, numA, numB), 520, 60);

  const chart2 = withRect(embed('2'), 620, 400);
  const plate2 = withRect(el('div', { class: 'plate' }, chart2), 600, 420);
  const section2 = withRect(el('section', {}, plate2), 600, 440);

  const canvas = withRect(el('div', {}, section, kpis, section2), 0, 1040);
  return { canvas, section, plate, prose, chart1, kpis, numA, section2, plate2, chart2 };
}

describe('collectDropSlots — every flow gap document-wide, packed containers excluded', () => {
  it('never offers a slot whose container is a packed (grid) container', () => {
    const d = buildDoc();
    const slots = collectDropSlots(d.canvas, d.plate, getStyle, getRect);
    expect(slots.some(s => s.container === d.kpis)).toBe(false);
  });

  it('offers dropping BEFORE the packed grid, at the top level (grid is a valid neighbor, not a container)', () => {
    const d = buildDoc();
    const slots = collectDropSlots(d.canvas, d.plate, getStyle, getRect);
    expect(slots.some(s => s.container === d.canvas && s.before === d.kpis)).toBe(true);
  });

  it('offers gaps INSIDE another section (drop between/inside other cards), i.e. is not parent-scoped', () => {
    const d = buildDoc();
    const slots = collectDropSlots(d.canvas, d.plate, getStyle, getRect);
    expect(slots.some(s => s.container === d.section2)).toBe(true);
  });

  it('never offers a gap inside the dragged unit itself (no drop-onto-self)', () => {
    const d = buildDoc();
    const slots = collectDropSlots(d.canvas, d.plate, getStyle, getRect);
    expect(slots.some(s => s.container === d.plate)).toBe(false);
    expect(slots.some(s => s.before === d.plate)).toBe(false); // its own current slot is excluded
  });

  it('does not recurse into embeds or number callouts (no dropping inside a rendered chart)', () => {
    const d = buildDoc();
    const slots = collectDropSlots(d.canvas, d.plate, getStyle, getRect);
    expect(slots.some(s => s.container === d.chart2)).toBe(false);
    expect(slots.some(s => s.container === d.numA)).toBe(false);
  });
});

describe('chooseDropSlot — nearest gap by pointer Y', () => {
  const slots: DropSlot[] = [
    { container: document.createElement('div'), before: null, y: 100, depth: 0 },
    { container: document.createElement('div'), before: null, y: 300, depth: 0 },
    { container: document.createElement('div'), before: null, y: 620, depth: 0 },
  ];
  it('picks the gap closest to the pointer', () => {
    expect(chooseDropSlot(slots, 290)?.y).toBe(300);
    expect(chooseDropSlot(slots, 610)?.y).toBe(620);
  });
  it('prefers the shallower container when two gaps sit at the same Y', () => {
    const shallow = { container: document.createElement('div'), before: null, y: 200, depth: 0 };
    const deep = { container: document.createElement('div'), before: null, y: 200, depth: 3 };
    expect(chooseDropSlot([deep, shallow], 200)).toBe(shallow);
  });
  it('returns null for no slots', () => expect(chooseDropSlot([], 100)).toBeNull());
});

describe('applyDrop — splices the card into the chosen gap', () => {
  it('moves a nested card to a different section (true cross-container move)', () => {
    const d = buildDoc();
    applyDrop(d.plate, { container: d.section2, before: d.plate2, depth: 1, y: 600 });
    // plate is now the first child of section2, before plate2
    expect(d.section2.firstElementChild).toBe(d.plate);
    expect(d.section.contains(d.plate)).toBe(false);
  });

  it('appends when before is null', () => {
    const d = buildDoc();
    applyDrop(d.plate, { container: d.canvas, before: null, depth: 0, y: 1040 });
    expect(d.canvas.lastElementChild).toBe(d.plate);
  });
});

describe('move → serialize round-trip + contract preservation', () => {
  it('the saved story reflects the new order AND the moved widget keeps a resizable (flow) home', () => {
    const chart1 = embed('11');
    chart1.setAttribute('data-mx-osz', 'width:600px;height:496px');
    chart1.setAttribute('style', 'width:600px;height:496px');
    const plate = el('div', { class: 'plate' }, chart1);
    const section = el('section', {}, el('p', {}), plate);

    const chart2 = embed('22');
    chart2.setAttribute('data-mx-osz', 'width:100%;height:400px');
    const section2 = el('section', {}, chart2);

    const canvas = el('div', {}, section, section2);

    // Move plate (card for chart 11) to the very end of the canvas, hoisting it out of its section.
    applyDrop(plate, { container: canvas, before: null, depth: 0, y: 9999 });

    // chart 22 now serializes before chart 11
    const out = serializeEditedStory(canvas, []);
    expect(out.indexOf('data-question-id="22"')).toBeLessThan(out.indexOf('data-question-id="11"'));

    // …and chart 11 sits in a flow context (canvas), so it stays freely px-resizable.
    expect(findWidgetLayoutViolations(chart1, canvas, getStyle)).toEqual([]);
  });
});
