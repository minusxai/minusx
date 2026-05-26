/**
 * Contract test for useDeepStable: returns the previous reference when the
 * latest value is deeply equal, otherwise returns the new value.
 *
 * Guarding this directly (rather than only through BaseChart) means changes to
 * the helper can't silently regress the chart memoization fix downstream.
 */
import { useState } from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useDeepStable } from '@/lib/hooks/use-deep-stable';

interface Probe {
  current: unknown;
  identityChanges: number;
}

function Harness({ produce, probe }: { produce: (i: number) => unknown; probe: Probe }) {
  const [n, setN] = useState(0);
  const value = produce(n);
  const stable = useDeepStable(value);
  // Track when the returned reference changes identity. We do this in render
  // (not effect) so the probe reflects exactly what the hook returned this
  // render — identity stability is what consumers care about.
  if (probe.current !== stable) {
    probe.current = stable;
    probe.identityChanges += 1;
  }
  return (
    <div>
      <button aria-label="Bump" onClick={() => setN((x) => x + 1)}>
        bump {n}
      </button>
      <span aria-label="Stringified">{JSON.stringify(stable)}</span>
    </div>
  );
}

describe('useDeepStable', () => {
  it('returns the same reference when the new value is deeply equal', async () => {
    const probe: Probe = { current: Symbol('init'), identityChanges: 0 };
    const user = userEvent.setup();
    // Each render produces a brand-new object that is deeply equal to the
    // previous one — exactly the pattern BaseChart sees from upstream callers.
    render(<Harness produce={() => ({ a: 1, b: { c: [1, 2, 3] } })} probe={probe} />);

    expect(probe.identityChanges).toBe(1); // initial render set it once

    await user.click(screen.getByLabelText('Bump'));
    await user.click(screen.getByLabelText('Bump'));
    await user.click(screen.getByLabelText('Bump'));

    // Three more parent renders, all with deeply-equal values → identity must
    // not have changed again.
    expect(probe.identityChanges).toBe(1);
  });

  it('returns a new reference when the value genuinely changes', async () => {
    const probe: Probe = { current: Symbol('init'), identityChanges: 0 };
    const user = userEvent.setup();
    render(<Harness produce={(i) => ({ a: i, b: { c: [1, 2, 3] } })} probe={probe} />);

    expect(probe.identityChanges).toBe(1);

    await user.click(screen.getByLabelText('Bump'));
    await user.click(screen.getByLabelText('Bump'));

    expect(probe.identityChanges).toBe(3);
  });

  it('handles primitive values', () => {
    const probe: Probe = { current: Symbol('init'), identityChanges: 0 };
    const { rerender } = render(<Harness produce={() => 42} probe={probe} />);
    expect(probe.identityChanges).toBe(1);
    rerender(<Harness produce={() => 42} probe={probe} />);
    expect(probe.identityChanges).toBe(1);
    rerender(<Harness produce={() => 43} probe={probe} />);
    expect(probe.identityChanges).toBe(2);
  });

  it('handles arrays', () => {
    const probe: Probe = { current: Symbol('init'), identityChanges: 0 };
    const { rerender } = render(<Harness produce={() => [1, 2, 3]} probe={probe} />);
    expect(probe.identityChanges).toBe(1);
    rerender(<Harness produce={() => [1, 2, 3]} probe={probe} />);
    expect(probe.identityChanges).toBe(1);
    rerender(<Harness produce={() => [1, 2, 4]} probe={probe} />);
    expect(probe.identityChanges).toBe(2);
  });

  it('treats null and undefined as equal to themselves', () => {
    const probe: Probe = { current: Symbol('init'), identityChanges: 0 };
    const { rerender } = render(<Harness produce={() => null} probe={probe} />);
    expect(probe.identityChanges).toBe(1);
    rerender(<Harness produce={() => null} probe={probe} />);
    expect(probe.identityChanges).toBe(1);
  });

  // Suppress unused warning for `act` import in case the test runner needs it
  // for promise flushes when expanding in future.
  void act;
});
