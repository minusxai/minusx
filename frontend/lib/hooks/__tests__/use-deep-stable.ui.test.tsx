/**
 * Contract test for useDeepStable: returns the previous reference when the
 * latest value is deeply equal, otherwise returns the new value.
 *
 * Guarding this directly (rather than only through BaseChart) means changes to
 * the helper can't silently regress the chart memoization fix downstream.
 *
 * react-hooks/refs is disabled file-wide: the test harness deliberately
 * inspects ref values during render to observe identity stability — the
 * exact property under test.
 */
/* eslint-disable react-hooks/refs */
import { useRef, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useDeepStable } from '@/lib/hooks/use-deep-stable';

/**
 * Harness reports the cumulative number of distinct identities the hook has
 * returned in its lifetime via an `aria-label`-tagged span. The test reads
 * the textContent rather than mutating outer-scope state — that avoids the
 * lint rule against assigning to vars declared outside a component during
 * render, while still observing the exact property we care about.
 */
function Harness({ produce }: { produce: (i: number) => unknown }) {
  const [n, setN] = useState(0);
  const value = produce(n);
  const stable = useDeepStable(value);
  // useRef + careful access via Object.is — same identity counts as no change.
  // The increment happens during render but on a local ref, which is allowed.
  const lastSeen = useRef<{ ref: unknown; count: number }>({ ref: stable, count: 1 });
   
  if (!Object.is(lastSeen.current.ref, stable)) {
     
    lastSeen.current = { ref: stable, count: lastSeen.current.count + 1 };
  }
   
  const count = lastSeen.current.count;
  return (
    <div>
      <button aria-label="Bump" onClick={() => setN((x) => x + 1)}>
        bump {n}
      </button>
      <span aria-label="IdentityChanges">{count}</span>
      <span aria-label="Stringified">{JSON.stringify(stable)}</span>
    </div>
  );
}

function identityCount(): number {
  return Number(screen.getByLabelText('IdentityChanges').textContent);
}

describe('useDeepStable', () => {
  it('returns the same reference when the new value is deeply equal', async () => {
    const user = userEvent.setup();
    // Each render produces a brand-new object that is deeply equal to the
    // previous one — exactly the pattern BaseChart sees from upstream callers.
    render(<Harness produce={() => ({ a: 1, b: { c: [1, 2, 3] } })} />);

    expect(identityCount()).toBe(1); // initial render set it once

    await user.click(screen.getByLabelText('Bump'));
    await user.click(screen.getByLabelText('Bump'));
    await user.click(screen.getByLabelText('Bump'));

    // Three more parent renders, all with deeply-equal values → identity must
    // not have changed again.
    expect(identityCount()).toBe(1);
  });

  it('returns a new reference when the value genuinely changes', async () => {
    const user = userEvent.setup();
    render(<Harness produce={(i) => ({ a: i, b: { c: [1, 2, 3] } })} />);

    expect(identityCount()).toBe(1);

    await user.click(screen.getByLabelText('Bump'));
    await user.click(screen.getByLabelText('Bump'));

    expect(identityCount()).toBe(3);
  });

  it('handles primitive values', () => {
    const { rerender } = render(<Harness produce={() => 42} />);
    expect(identityCount()).toBe(1);
    rerender(<Harness produce={() => 42} />);
    expect(identityCount()).toBe(1);
    rerender(<Harness produce={() => 43} />);
    expect(identityCount()).toBe(2);
  });

  it('handles arrays', () => {
    const { rerender } = render(<Harness produce={() => [1, 2, 3]} />);
    expect(identityCount()).toBe(1);
    rerender(<Harness produce={() => [1, 2, 3]} />);
    expect(identityCount()).toBe(1);
    rerender(<Harness produce={() => [1, 2, 4]} />);
    expect(identityCount()).toBe(2);
  });

  it('treats null and undefined as equal to themselves', () => {
    const { rerender } = render(<Harness produce={() => null} />);
    expect(identityCount()).toBe(1);
    rerender(<Harness produce={() => null} />);
    expect(identityCount()).toBe(1);
  });
});
