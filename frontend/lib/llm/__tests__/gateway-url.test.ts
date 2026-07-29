/**
 * One gateway, two planes — and how they are addressed.
 *
 * `MX_GATEWAY_URL` is the origin: the control plane (orgs, credits, status)
 * sits at its root, inference at its `/v1`. That is one variable for the normal
 * case, which matters because two that can disagree eventually do — and the
 * disagreement surfaces as an auth failure against a gateway that never minted
 * the key, a long way from its cause.
 *
 * `MX_GATEWAY_URL_PROXY` exists because the two planes are only ONE origin from
 * outside. Behind the reverse proxy they are separate services on separate
 * ports, so an install on the same network as the gateway cannot reach both
 * through a single address. Setting it is how you say "these really are two
 * places" — deliberately, rather than by forgetting to keep a second variable
 * in step.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL = { ...process.env };

async function load(env: Record<string, string | undefined>) {
  for (const k of ['MX_GATEWAY_URL', 'MX_GATEWAY_URL_PROXY']) {
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
    expect(c.MX_GATEWAY_URL_PROXY).toBe('https://llm.minusx.ai/v1');
  });

  it('moves inference with the origin, so staging is ONE variable', async () => {
    const c = await load({ MX_GATEWAY_URL: 'https://gateway.example.com' });
    expect(c.MX_GATEWAY_URL_PROXY).toBe('https://gateway.example.com/v1');
  });

  it('tolerates a trailing slash rather than emitting a double one', async () => {
    const c = await load({ MX_GATEWAY_URL: 'https://gateway.example.com/' });
    expect(c.MX_GATEWAY_ORIGIN).toBe('https://gateway.example.com');
    expect(c.MX_GATEWAY_URL_PROXY).toBe('https://gateway.example.com/v1');
  });

  it('lets the two planes be genuinely different addresses', async () => {
    // The case the single variable cannot express: an install sharing a network
    // with the gateway reaches the control plane and the inference proxy as two
    // separate services, never through one origin.
    const c = await load({
      MX_GATEWAY_URL: 'http://control-plane.internal:9001',
      MX_GATEWAY_URL_PROXY: 'http://inference.internal:9002/v1',
    });
    expect(c.MX_GATEWAY_ORIGIN).toBe('http://control-plane.internal:9001');
    expect(c.MX_GATEWAY_URL_PROXY).toBe('http://inference.internal:9002/v1');
  });

  it('does not append /v1 to an override that already carries it', async () => {
    // The override is the FULL inference URL, not an origin — it has to be,
    // because the port it lives on is not the port the control plane is on.
    const c = await load({ MX_GATEWAY_URL_PROXY: 'http://inference.internal:9002/v1' });
    expect(c.MX_GATEWAY_URL_PROXY).toBe('http://inference.internal:9002/v1');
  });
});
