// OTP generation must be cryptographically secure.
//
// A 2FA code is a secret an attacker is actively trying to predict. `Math.random()`
// is a fast non-cryptographic PRNG: its internal state is recoverable from a modest
// number of observed outputs, and once recovered every subsequent code is
// predictable. Observing outputs is not hypothetical here — anyone who can request
// an OTP for their OWN account gets a stream of samples from the same generator.
//
// The range/format assertions below are secondary; the load-bearing test is that
// `Math.random` is never consulted.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateOTP } from '@/lib/auth/otp-utils';

afterEach(() => vi.restoreAllMocks());

describe('generateOTP', () => {
  it('never uses Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    for (let i = 0; i < 50; i++) generateOTP();
    expect(spy).not.toHaveBeenCalled();
  });

  it('is always exactly six digits', () => {
    for (let i = 0; i < 500; i++) {
      expect(generateOTP()).toMatch(/^[0-9]{6}$/);
    }
  });

  it('covers the full 100000-999999 range without overflowing it', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 2000; i++) {
      const n = Number(generateOTP());
      if (n < min) min = n;
      if (n > max) max = n;
    }
    expect(min).toBeGreaterThanOrEqual(100000);
    expect(max).toBeLessThanOrEqual(999999);
    // A generator stuck in a narrow band would still satisfy the bounds above.
    expect(max - min).toBeGreaterThan(500000);
  });

  it('does not repeat over a large sample', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateOTP());
    // 1000 draws from 900k values: collisions are possible but a degenerate
    // generator shows up as a sharp drop in distinct values.
    expect(seen.size).toBeGreaterThan(990);
  });
});
