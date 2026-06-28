import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PresentationProvider, usePresentation } from '../PresentationContext';

/**
 * Drives the REAL provider through a tiny consumer that exposes the toggle +
 * isPresenting via aria-labelled nodes. The Fullscreen API is stubbed on the
 * jsdom document/Element so we can assert request/exit + the change event.
 */
function Consumer() {
  const p = usePresentation();
  if (!p) return <div aria-label="status">no-provider</div>;
  return (
    <>
      <button aria-label="toggle present" onClick={p.toggle}>toggle</button>
      <div aria-label="status">{p.isPresenting ? 'presenting' : 'idle'}</div>
      <div aria-label="supported">{p.supported ? 'yes' : 'no'}</div>
    </>
  );
}

describe('PresentationContext', () => {
  // Simulated fullscreen target — what document.fullscreenElement reports. The
  // browser sets this when requestFullscreen resolves; the test drives it manually.
  let fsTarget: Element | null = null;
  const requestFullscreen = vi.fn(() => Promise.resolve());
  const exitFullscreen = vi.fn(() => {
    fsTarget = null;
    return Promise.resolve();
  });

  beforeEach(() => {
    fsTarget = null;
    requestFullscreen.mockClear();
    exitFullscreen.mockClear();
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fsTarget });
    Element.prototype.requestFullscreen = requestFullscreen;
    document.exitFullscreen = exitFullscreen;
  });

  afterEach(() => {
    fsTarget = null;
  });

  it('reports the Fullscreen API as supported', async () => {
    render(<PresentationProvider><Consumer /></PresentationProvider>);
    // supported is set in an effect → flush
    await act(async () => {});
    expect(screen.getByLabelText('supported').textContent).toBe('yes');
  });

  it('enters fullscreen on toggle, reflects isPresenting on fullscreenchange, then exits', async () => {
    render(<PresentationProvider><Consumer /></PresentationProvider>);
    await act(async () => {});

    expect(screen.getByLabelText('status').textContent).toBe('idle');

    // Enter
    await act(async () => { fireEvent.click(screen.getByLabelText('toggle present')); });
    expect(requestFullscreen).toHaveBeenCalledTimes(1);

    // Browser sets fullscreenElement to the surface, then fires fullscreenchange
    fsTarget = document.querySelector('[data-presentation-surface]');
    expect(fsTarget).not.toBeNull();
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });
    expect(screen.getByLabelText('status').textContent).toBe('presenting');

    // Exit
    await act(async () => { fireEvent.click(screen.getByLabelText('toggle present')); });
    expect(exitFullscreen).toHaveBeenCalledTimes(1);

    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });
    expect(screen.getByLabelText('status').textContent).toBe('idle');
  });
});
