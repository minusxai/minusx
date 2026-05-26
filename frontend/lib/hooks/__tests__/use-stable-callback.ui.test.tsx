/**
 * Contract tests for useStableCallback + shallowEqualExcept.
 *
 * useStableCallback's whole point is: the returned function reference stays
 * the same across renders, BUT invoking it always runs the latest closure the
 * caller passed in. Both halves of that contract get a test here so a future
 * refactor can't quietly break one.
 *
 * react-hooks/refs is disabled file-wide: the test harness deliberately
 * inspects ref values during render to observe identity stability — the
 * exact property under test.
 */
/* eslint-disable react-hooks/refs */
import { useRef, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useStableCallback, shallowEqualExcept } from '@/lib/hooks/use-stable-callback';

/**
 * Helper that exposes the number of distinct callback identities ever returned
 * by useStableCallback via a tagged aria-label. Avoids mutating outer-scope
 * vars during render (which trips react-hooks/globals).
 */
function StabilityProbe({ cb }: { cb: () => void }) {
  const stable = useStableCallback(cb);
  const lastSeen = useRef<{ ref: unknown; count: number }>({ ref: stable, count: 1 });
  // eslint-disable-next-line react-hooks/refs
  if (!Object.is(lastSeen.current.ref, stable)) {
    // eslint-disable-next-line react-hooks/refs
    lastSeen.current = { ref: stable, count: lastSeen.current.count + 1 };
  }
  // eslint-disable-next-line react-hooks/refs
  const count = lastSeen.current.count;
  return <span aria-label="IdentityCount">{count}</span>;
}

describe('useStableCallback', () => {
  it('returns a function whose identity is stable across re-renders', () => {
    const { rerender } = render(<StabilityProbe cb={() => undefined} />);
    rerender(<StabilityProbe cb={() => undefined} />);
    rerender(<StabilityProbe cb={() => undefined} />);

    // Three renders, three brand-new caller closures — but the hook should
    // have surfaced the same wrapper identity each time.
    expect(screen.getByLabelText('IdentityCount').textContent).toBe('1');
  });

  it('always invokes the latest closure', async () => {
    /**
     * Inner harness writes the latest return value to its own DOM. The
     * "current closure" is passed in via props, so we don't need to mutate
     * outer-scope state during render.
     */
    function ResultProbe({ cb }: { cb: () => string }) {
      const stable = useStableCallback(cb);
      const [result, setResult] = useState<string>('-');
      return (
        <>
          <button aria-label="Run" onClick={() => setResult(stable())}>run</button>
          <span aria-label="Result">{result}</span>
        </>
      );
    }

    const cbA = () => 'A';
    const cbB = () => 'B';
    const { rerender } = render(<ResultProbe cb={cbA} />);

    await userEvent.click(screen.getByLabelText('Run'));
    expect(screen.getByLabelText('Result').textContent).toBe('A');

    rerender(<ResultProbe cb={cbB} />);

    await userEvent.click(screen.getByLabelText('Run'));
    expect(screen.getByLabelText('Result').textContent).toBe('B');
  });

  it('survives state-driven re-renders without identity churn', async () => {
    function Harness() {
      const [n, setN] = useState(0);
      return (
        <>
          <StabilityProbe cb={() => undefined} />
          <button aria-label="Bump" onClick={() => setN(n + 1)}>{n}</button>
        </>
      );
    }
    render(<Harness />);

    await userEvent.click(screen.getByLabelText('Bump'));
    await userEvent.click(screen.getByLabelText('Bump'));

    expect(screen.getByLabelText('IdentityCount').textContent).toBe('1');
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
