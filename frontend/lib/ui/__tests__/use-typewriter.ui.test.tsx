/**
 * The wizard types every heading out one character at a time. At 35ms/char a heading like
 * "Step 2: Let's create a Knowledge Base." takes ~13 seconds, and it runs on EVERY step — around
 * a minute of dead time across the flow, during which the controls beneath are already live and
 * clickable. There was no way to skip it: the only "Skip" on screen abandoned setup entirely.
 *
 * So: any click or keypress completes the current heading immediately. Escape-hatch behaviour,
 * not a setting — the animation is a flourish and the second time a user sees it, it is a wait.
 *
 * This hook also replaces six byte-identical copies of the same effect (HelloWorldContent, four
 * wizard steps, ConnectionFormV2), which is how five of them ended up unskippable in the first
 * place.
 */

import { renderHook, act } from '@testing-library/react';
import { useTypewriter, TYPEWRITER_SPEED } from '../use-typewriter';

function typeFor(ms: number) {
  act(() => { vi.advanceTimersByTime(ms); });
}

describe('useTypewriter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('reveals the text one character at a time', () => {
    const { result } = renderHook(() => useTypewriter('Hello'));

    expect(result.current.displayed).toBe('');
    typeFor(TYPEWRITER_SPEED * 2);
    expect(result.current.displayed).toBe('He');
    expect(result.current.done).toBe(false);
  });

  it('finishes on its own and reports done', () => {
    const { result } = renderHook(() => useTypewriter('Hello'));

    typeFor(TYPEWRITER_SPEED * 5);

    expect(result.current.displayed).toBe('Hello');
    expect(result.current.done).toBe(true);
  });

  it('completes immediately on a click anywhere in the document', () => {
    const { result } = renderHook(() => useTypewriter('A much longer heading than this'));

    typeFor(TYPEWRITER_SPEED);
    act(() => { document.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(result.current.displayed).toBe('A much longer heading than this');
    expect(result.current.done).toBe(true);
  });

  it('completes immediately on a keypress', () => {
    const { result } = renderHook(() => useTypewriter('A much longer heading than this'));

    typeFor(TYPEWRITER_SPEED);
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })); });

    expect(result.current.displayed).toBe('A much longer heading than this');
    expect(result.current.done).toBe(true);
  });

  it('exposes reveal() for callers that want their own affordance', () => {
    const { result } = renderHook(() => useTypewriter('Hello there'));

    act(() => { result.current.reveal(); });

    expect(result.current.displayed).toBe('Hello there');
    expect(result.current.done).toBe(true);
  });

  it('treats no text as already done, and renders nothing', () => {
    const { result } = renderHook(() => useTypewriter(undefined));

    expect(result.current.displayed).toBe('');
    expect(result.current.done).toBe(true);
  });

  it('restarts when the text changes — each wizard step types its own heading', () => {
    const { result, rerender } = renderHook(({ text }) => useTypewriter(text), {
      initialProps: { text: 'First heading' },
    });

    typeFor(TYPEWRITER_SPEED * 20);
    expect(result.current.done).toBe(true);

    rerender({ text: 'Second heading' });

    expect(result.current.displayed).toBe('');
    expect(result.current.done).toBe(false);
  });

  it('stops listening once complete, so later clicks are not intercepted', () => {
    const onClick = vi.fn();
    document.addEventListener('click', onClick);
    const { result } = renderHook(() => useTypewriter('Hi'));

    typeFor(TYPEWRITER_SPEED * 3);
    expect(result.current.done).toBe(true);

    act(() => { document.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onClick).toHaveBeenCalledTimes(1);

    document.removeEventListener('click', onClick);
  });
});
