// Unit tests for the runtime-E2E secret gate (Tests/QA/Evals Arch V2 — Phase 5 enabler).
// The matcher is the security-critical bit: only the exact configured secret enables
// the store-exposure opt-in. The configured secret carries a trailing newline here
// to assert `.trim()` tolerance (a common docker/compose env-setting gotcha).

vi.mock('@/lib/config', () => ({ E2E_RUNTIME_SECRET: 'sekret-abc-12345\n' }));

import { matchesE2ESecret, E2E_PARAM, E2E_COOKIE, E2E_HEADER } from '@/lib/auth/e2e-runtime';

describe('matchesE2ESecret (secret configured)', () => {
  it('matches the exact configured secret (trailing whitespace trimmed)', () => {
    expect(matchesE2ESecret('sekret-abc-12345')).toBe(true);
  });

  it('rejects a wrong value', () => {
    expect(matchesE2ESecret('sekret-abc-12346')).toBe(false);
    expect(matchesE2ESecret('totally-different')).toBe(false);
  });

  it('rejects null / undefined / empty', () => {
    expect(matchesE2ESecret(null)).toBe(false);
    expect(matchesE2ESecret(undefined)).toBe(false);
    expect(matchesE2ESecret('')).toBe(false);
  });

  it('rejects a length-mismatched value without throwing (timingSafeEqual guard)', () => {
    expect(matchesE2ESecret('short')).toBe(false);
    expect(matchesE2ESecret('sekret-abc-12345-and-then-some-more')).toBe(false);
  });

  it('exposes stable param/cookie/header names', () => {
    expect([E2E_PARAM, E2E_COOKIE, E2E_HEADER]).toEqual(['e2e', 'mx_e2e', 'x-e2e-enabled']);
  });
});
