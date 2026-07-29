/**
 * One gateway, two planes — and one variable that moves both.
 *
 * `MX_GATEWAY_URL` is the origin; inference is that plus `/v1`. Before this was
 * derived, pointing an install at a staging gateway meant setting two variables
 * that had to agree, and forgetting the second sent inference to PRODUCTION
 * while the control plane talked to staging. That failed as an auth error a
 * long way from its cause, because the key had been minted by the other one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL = { ...process.env };

async function load(env: Record<string, string | undefined>) {
  for (const k of ['MX_GATEWAY_URL', 'MINUSX_GATEWAY_URL']) {
    delete (process.env as Record<string, string | undefined>)[k];
  }
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) (process.env as Record<string, string>)[k] = v;
  }
  vi.resetModules();
  return import('../../config');
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { process.env = { ...ORIGINAL }; });

describe('the gateway URLs', () => {
  it('defaults to the managed gateway when nothing is set', async () => {
    const c = await load({});
    expect(c.MX_GATEWAY_ORIGIN).toBe('https://llm.minusx.ai');
    expect(c.MINUSX_GATEWAY_URL).toBe('https://llm.minusx.ai/v1');
  });

  it('moves inference with the origin — the whole point', async () => {
    const c = await load({ MX_GATEWAY_URL: 'https://staging-llm.minusxapp.com' });
    expect(c.MINUSX_GATEWAY_URL).toBe('https://staging-llm.minusxapp.com/v1');
  });

  it('tolerates a trailing slash rather than emitting a double one', async () => {
    const c = await load({ MX_GATEWAY_URL: 'https://staging-llm.minusxapp.com/' });
    expect(c.MX_GATEWAY_ORIGIN).toBe('https://staging-llm.minusxapp.com');
    expect(c.MINUSX_GATEWAY_URL).toBe('https://staging-llm.minusxapp.com/v1');
  });

  it('ignores a stray MINUSX_GATEWAY_URL rather than letting it disagree', async () => {
    // There is no second variable any more. Honouring one that happened to be
    // left in an environment is how the two drift apart again — and the drift
    // surfaces as an auth failure against a gateway that never minted the key.
    const c = await load({
      MX_GATEWAY_URL: 'https://staging-llm.minusxapp.com',
      MINUSX_GATEWAY_URL: 'https://stale-leftover.internal/v1',
    });
    expect(c.MINUSX_GATEWAY_URL).toBe('https://staging-llm.minusxapp.com/v1');
  });
});
