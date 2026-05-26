/**
 * Contract tests for useStableCallback + shallowEqualExcept.
 *
 * useStableCallback's whole point is: the returned function reference stays
 * the same across renders, BUT invoking it always runs the latest closure the
 * caller passed in. Both halves of that contract get a test here so a future
 * refactor can't quietly break one.
 */
import { useState } from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useStableCallback, shallowEqualExcept } from '@/lib/hooks/use-stable-callback';

describe('useStableCallback', () => {
  it('returns a function whose identity is stable across re-renders', async () => {
    const seenIdentities = new Set<() => void>();

    function Harness({ cb }: { cb: () => void }) {
      const stable = useStableCallback(cb);
      seenIdentities.add(stable);
      return null;
    }

    const { rerender } = render(<Harness cb={() => undefined} />);
    rerender(<Harness cb={() => undefined} />);
    rerender(<Harness cb={() => undefined} />);

    // Three renders, three brand-new caller closures, but useStableCallback
    // should have surfaced the same wrapper identity each time.
    expect(seenIdentities.size).toBe(1);
  });

  it('always invokes the latest closure', async () => {
    let latest: () => string = () => 'A';
    let returned: string | null = null;

    function Harness({ cb }: { cb: () => string }) {
      const stable = useStableCallback(cb);
      return (
        <button aria-label="Run" onClick={() => { returned = stable(); }}>run</button>
      );
    }

    const { rerender } = render(<Harness cb={latest} />);

    await userEvent.click(screen.getByLabelText('Run'));
    expect(returned).toBe('A');

    latest = () => 'B';
    rerender(<Harness cb={latest} />);

    await userEvent.click(screen.getByLabelText('Run'));
    expect(returned).toBe('B');
  });

  it('survives state-driven re-renders without identity churn', async () => {
    let stableRef: (() => void) | null = null;
    const ids = new Set<() => void>();

    function Harness() {
      const [n, setN] = useState(0);
      const cb = useStableCallback(() => undefined);
      stableRef = cb;
      ids.add(cb);
      return <button aria-label="Bump" onClick={() => setN(n + 1)}>{n}</button>;
    }

    render(<Harness />);
    const first = stableRef;

    await userEvent.click(screen.getByLabelText('Bump'));
    await userEvent.click(screen.getByLabelText('Bump'));

    expect(ids.size).toBe(1);
    expect(stableRef).toBe(first);

    // suppress unused warning for `act`
    void act;
  });
});

describe('shallowEqualExcept', () => {
  it('returns true when all non-ignored props are strictly equal', () => {
    const fn1 = () => {};
    const fn2 = () => {};
    expect(shallowEqualExcept(
      { a: 1, b: 'x', onChange: fn1 },
      { a: 1, b: 'x', onChange: fn2 },
      ['onChange'],
    )).toBe(true);
  });

  it('returns false when a non-ignored prop differs', () => {
    const fn1 = () => {};
    expect(shallowEqualExcept(
      { a: 1, b: 'x', onChange: fn1 },
      { a: 2, b: 'x', onChange: fn1 },
      ['onChange'],
    )).toBe(false);
  });

  it('returns false when prop counts differ (added/removed key)', () => {
    expect(shallowEqualExcept(
      { a: 1, b: 'x' } as { a: number; b: string; c?: number },
      { a: 1, b: 'x', c: 3 } as { a: number; b: string; c?: number },
      [],
    )).toBe(false);
  });
});
