/**
 * The surface link bridge is what keeps a click on a dashboard tile title (or a story embed's
 * title) a CLIENT navigation. Those anchors live in a nested React root inside the surface
 * iframe, where `next/link` has no router context and silently falls back to the browser's
 * default navigation — a full document load that resets Redux (and with it anything typed into
 * the side chat). These tests pin the interception rules.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bridgeSurfaceLinks } from '../surface-link-bridge';

function makeDoc(): Document {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write('<!DOCTYPE html><html><head><base target="_top"></head><body></body></html>');
  doc.close();
  return doc;
}

function anchor(doc: Document, href: string, attrs: Record<string, string> = {}) {
  const a = doc.createElement('a');
  a.href = href;
  a.textContent = 'Tile title';
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  doc.body.appendChild(a);
  return a;
}

/** A click that a real user makes: primary button, bubbling, cancelable. */
function click(a: HTMLAnchorElement, init: MouseEventInit = {}) {
  const ev = new a.ownerDocument.defaultView!.MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  });
  a.dispatchEvent(ev);
  return ev;
}

describe('bridgeSurfaceLinks', () => {
  let doc: Document;
  let navigate: ReturnType<typeof vi.fn<(href: string) => void>>;
  let dispose: () => void;

  beforeEach(() => {
    window.history.replaceState({}, '', '/p/tutorial');
    doc = makeDoc();
    navigate = vi.fn();
    dispose = bridgeSurfaceLinks(doc, navigate);
  });

  afterEach(() => {
    dispose();
    document.body.innerHTML = '';
  });

  it('intercepts a same-origin link and hands it to the app router', () => {
    const a = anchor(doc, '/f/42?dashboard=7');
    const ev = click(a);

    expect(navigate).toHaveBeenCalledWith('/f/42?dashboard=7');
    expect(ev.defaultPrevented).toBe(true);
  });

  it('keeps the hash on the target', () => {
    click(anchor(doc, '/f/42#chart'));
    expect(navigate).toHaveBeenCalledWith('/f/42#chart');
  });

  it('carries mode and impersonation params over from the top window', () => {
    window.history.replaceState({}, '', '/p/tutorial?mode=tutorial&as_user=7');
    click(anchor(doc, '/f/42'));
    const href = navigate.mock.calls[0][0] as string;
    expect(href.startsWith('/f/42?')).toBe(true);
    expect(new URLSearchParams(href.split('?')[1]).get('mode')).toBe('tutorial');
    expect(new URLSearchParams(href.split('?')[1]).get('as_user')).toBe('7');
  });

  it('leaves cross-origin links to the browser', () => {
    const ev = click(anchor(doc, 'https://example.com/docs'));
    expect(navigate).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('leaves explicit new-tab, download and modified clicks to the browser', () => {
    expect(click(anchor(doc, '/f/1', { target: '_blank' })).defaultPrevented).toBe(false);
    expect(click(anchor(doc, '/f/2', { download: '' })).defaultPrevented).toBe(false);
    expect(click(anchor(doc, '/f/3'), { metaKey: true }).defaultPrevented).toBe(false);
    expect(click(anchor(doc, '/f/4'), { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(click(anchor(doc, '/f/5'), { shiftKey: true }).defaultPrevented).toBe(false);
    expect(click(anchor(doc, '/f/6'), { button: 1 }).defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('respects a handler that already cancelled the click (dashboard edit mode)', () => {
    const a = anchor(doc, '/f/42');
    a.addEventListener('click', (e) => e.preventDefault());
    click(a);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('intercepts a click on a child of the anchor', () => {
    const a = anchor(doc, '/f/42');
    const span = doc.createElement('span');
    a.appendChild(span);
    span.dispatchEvent(new doc.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    expect(navigate).toHaveBeenCalledWith('/f/42');
  });

  it('stops intercepting once disposed', () => {
    dispose();
    const ev = click(anchor(doc, '/f/42'));
    expect(navigate).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });
});
