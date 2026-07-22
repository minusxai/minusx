/**
 * `<Viewport>` pointer — window-scroll position plus PER-ELEMENT scroll offsets for the captured
 * surface (Story_Design_V2 §4: scroll is DOM state; the visual fix bakes it into the capture as
 * transforms, the TEXTUAL fix reports it in app state so the agent knows what is scrolled where).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readViewportPointer, readScrollOffsets } from '@/lib/screenshot/read-viewport';

function fileView(id: number, offsetHeight: number): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-file-id', String(id));
  Object.defineProperty(el, 'offsetHeight', { value: offsetHeight, configurable: true });
  el.getBoundingClientRect = () => ({ top: 0, left: 0, width: 800, height: offsetHeight, right: 800, bottom: offsetHeight, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

function scrolled(el: HTMLElement, sel: string, left: number, top: number): void {
  const target = el.querySelector(sel) as HTMLElement;
  Object.defineProperty(target, 'scrollLeft', { value: left, configurable: true });
  Object.defineProperty(target, 'scrollTop', { value: top, configurable: true });
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('readScrollOffsets — per-scrolled-element offsets for the captured surface', () => {
  it('reports each scrolled descendant with its offsets, described by aria-label when present', () => {
    const el = fileView(7, 4000);
    el.innerHTML = '<div id="wrap"><table aria-label="Results table"></table></div>';
    scrolled(el, 'table', 260, 0);
    const out = readScrollOffsets(7);
    expect(out).toContain('Results table');
    expect(out).toContain('260');
  });

  it('falls back to id/tag descriptors and includes both axes', () => {
    const el = fileView(8, 4000);
    el.innerHTML = '<div id="grid"></div>';
    scrolled(el, '#grid', 0, 480);
    const out = readScrollOffsets(8)!;
    expect(out).toContain('#grid');
    expect(out).toContain('480');
  });

  it('returns null when nothing is scrolled', () => {
    const el = fileView(9, 4000);
    el.innerHTML = '<div><table></table></div>';
    expect(readScrollOffsets(9)).toBeNull();
  });
});

describe('readViewportPointer — includes per-element scroll offsets', () => {
  it('appends scrolled-element offsets to the section pointer', () => {
    const el = fileView(10, 4000);
    el.innerHTML = '<div id="tbl"></div>';
    scrolled(el, '#tbl', 120, 0);
    const out = readViewportPointer(10)!;
    expect(out).toContain('section');
    expect(out).toContain('#tbl');
    expect(out).toContain('120');
  });

  it('still reports scrolled elements when the page itself fits one section', () => {
    const el = fileView(11, 200); // short page: no section pointer on its own
    el.innerHTML = '<div id="tbl"></div>';
    scrolled(el, '#tbl', 0, 90);
    const out = readViewportPointer(11);
    expect(out).not.toBeNull();
    expect(out!).toContain('#tbl');
  });

  it('returns null when there is neither a section pointer nor any scrolled element', () => {
    fileView(12, 200);
    expect(readViewportPointer(12)).toBeNull();
  });
});

// Renderer_v2 Phase 1: markers now apply to every flagged full-flow type (dashboard, notebook,
// report, …), which all scroll inside FileLayout's overflow:auto VStack — NOT the window. This
// pins the contract that makes that work with zero new code: the pointer derives scrollTop from
// the view's OWN getBoundingClientRect().top (viewport-relative, identical whichever ancestor
// scrolls), never from window.scrollY.
describe('readViewportPointer — scroll-container agnostic (dashboard/FileLayout model)', () => {
  it('reports the correct band when an ANCESTOR container is scrolled (rect.top < 0, window unscrolled)', () => {
    const el = document.createElement('div');
    el.setAttribute('data-file-id', '11');
    Object.defineProperty(el, 'offsetHeight', { value: 4000, configurable: true });
    // Container scrolled 900px: the view's top sits 900px ABOVE the viewport top. window.scrollY
    // stays 0 (jsdom default) — exactly the FileLayout VStack situation.
    el.getBoundingClientRect = () => ({ top: -900, left: 0, width: 800, height: 4000, right: 800, bottom: 3100, x: 0, y: -900, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(el);
    const out = readViewportPointer(11)!;
    // 4000px doc = 10 bands of 400px; scrolled to y=900 → top band is 3 (2 full bands above).
    expect(out).toContain('3');
    expect(out).toMatch(/section/i);
  });
});
