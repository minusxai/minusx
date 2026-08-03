/**
 * "Is this workspace's AI actually usable?" — the question the setup wizard has to answer.
 *
 * `hasLlmEndpoints` answers a different one: whether an `llm` section exists at all. The wizard
 * used that shape (`config.llm?.providers?.length`) to decide whether to show the AI-model step,
 * which means a provider entry carrying NO credential counts as configured — so the one step that
 * could fix it stops being offered, and every agent call fails with "No API key for provider".
 *
 * A provider is usable when it can authenticate: a key, Bedrock's SigV4 env credentials, or a
 * custom OpenAI-compatible endpoint that needs no key at all (a local model server).
 */
import { describe, it, expect } from 'vitest';
import { hasUsableLlmProvider } from '../llm-config-types';

describe('hasUsableLlmProvider', () => {
  it('is false for no config, no providers, or an empty list', () => {
    expect(hasUsableLlmProvider(undefined)).toBe(false);
    expect(hasUsableLlmProvider({})).toBe(false);
    expect(hasUsableLlmProvider({ providers: [] })).toBe(false);
  });

  // The exact state a fresh self-hosted workspace lands in: `Add provider` writes a `minusx`
  // entry, the gateway is unreachable so no key ever arrives, and the entry alone used to read
  // as "configured".
  it('is false for a provider entry with no credential', () => {
    expect(hasUsableLlmProvider({ providers: [{ name: 'minusx', provider: 'minusx' }] })).toBe(false);
  });

  it('is false when the key is blank or whitespace', () => {
    expect(hasUsableLlmProvider({ providers: [{ name: 'a', provider: 'anthropic', apiKey: '' }] })).toBe(false);
    expect(hasUsableLlmProvider({ providers: [{ name: 'a', provider: 'anthropic', apiKey: '   ' }] })).toBe(false);
  });

  it('is true for a provider carrying a key', () => {
    expect(hasUsableLlmProvider({ providers: [{ name: 'a', provider: 'anthropic', apiKey: 'sk-x' }] })).toBe(true);
  });

  it('is true for a stored secret ref, which is what a saved key looks like', () => {
    expect(hasUsableLlmProvider({
      providers: [{ name: 'a', provider: 'openai', apiKey: '@SECRETS/llm/openai' }],
    })).toBe(true);
  });

  it('is true for a custom OpenAI-compatible endpoint with no key (local model server)', () => {
    expect(hasUsableLlmProvider({
      providers: [{ name: 'local', provider: 'custom', baseUrl: 'http://localhost:11434/v1' }],
    })).toBe(true);
  });

  it('is false for a custom provider with neither key nor endpoint', () => {
    expect(hasUsableLlmProvider({ providers: [{ name: 'local', provider: 'custom' }] })).toBe(false);
  });

  // Bedrock authenticates via SigV4 environment credentials when no bearer token is given, so a
  // region is enough to make the entry meaningful.
  it('is true for bedrock configured with a region and no key', () => {
    expect(hasUsableLlmProvider({
      providers: [{ name: 'bedrock', provider: 'amazon-bedrock', awsRegion: 'us-east-1' }],
    })).toBe(true);
  });

  it('is true when ANY provider is usable, even beside a broken one', () => {
    expect(hasUsableLlmProvider({
      providers: [
        { name: 'minusx', provider: 'minusx' },
        { name: 'anthropic', provider: 'anthropic', apiKey: 'sk-x' },
      ],
    })).toBe(true);
  });
});
