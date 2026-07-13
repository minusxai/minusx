// Pure logic: redaction masks RAW values at registered secret paths (keys and
// structure stay intact), refs pass through, and round-tripped redacted
// placeholders are restored by element IDENTITY (never index).
import { describe, it, expect } from 'vitest';
import {
  redactRawConfigSecrets,
  restoreRedactedConfigSecrets,
  configSecretRefPath,
  REDACTED_SECRET,
} from '../config-secret-specs';

const REF = configSecretRefPath('org', 'bots', 'main-bot', 'bot_token');

describe('redactRawConfigSecrets', () => {
  it('masks raw secret values but keeps every key and non-secret value verbatim', () => {
    const config = {
      branding: { displayName: 'Acme' },
      bots: [{
        type: 'slack', name: 'main-bot', team_id: 'T0001',
        bot_token: 'xoxb-raw-token', signing_secret: 'shhh',
      }],
    };
    const out = redactRawConfigSecrets(config) as typeof config;
    expect(out.bots[0].bot_token).toBe(REDACTED_SECRET);
    expect(out.bots[0].signing_secret).toBe(REDACTED_SECRET);
    // Structure and non-secret values intact:
    expect(out.bots[0].name).toBe('main-bot');
    expect(out.bots[0].team_id).toBe('T0001');
    expect(out.branding.displayName).toBe('Acme');
    expect(JSON.stringify(out)).not.toContain('xoxb-raw-token');
    // Input not mutated:
    expect(config.bots[0].bot_token).toBe('xoxb-raw-token');
  });

  it('leaves @SECRETS refs untouched (they are safe to show)', () => {
    const config = { bots: [{ type: 'slack', name: 'main-bot', bot_token: REF }] };
    const out = redactRawConfigSecrets(config) as typeof config;
    expect(out.bots[0].bot_token).toBe(REF);
  });

  it('handles configs with no secret-bearing sections', () => {
    const config = { branding: { displayName: 'Acme' } };
    expect(redactRawConfigSecrets(config)).toEqual(config);
  });

  it('ignores non-string and absent secret fields', () => {
    const config = { bots: [{ type: 'slack', name: 'b' }] };
    expect(redactRawConfigSecrets(config)).toEqual(config);
  });
});

describe('restoreRedactedConfigSecrets', () => {
  const stored = {
    bots: [
      { type: 'slack', name: 'bot-a', bot_token: configSecretRefPath('org', 'bots', 'bot-a', 'bot_token') },
      { type: 'slack', name: 'bot-b', bot_token: 'legacy-raw-b' },
    ],
  };

  it('restores a round-tripped placeholder from the stored element with the same identity', () => {
    const incoming = { bots: [{ type: 'slack', name: 'bot-a', bot_token: REDACTED_SECRET }] };
    const out = restoreRedactedConfigSecrets(incoming, stored) as typeof stored;
    expect(out.bots[0].bot_token).toBe(configSecretRefPath('org', 'bots', 'bot-a', 'bot_token'));
  });

  it('matches by identity even when the array was reordered', () => {
    const incoming = {
      bots: [
        { type: 'slack', name: 'bot-b', bot_token: REDACTED_SECRET },
        { type: 'slack', name: 'bot-a', bot_token: REDACTED_SECRET },
      ],
    };
    const out = restoreRedactedConfigSecrets(incoming, stored) as typeof stored;
    expect(out.bots[0].bot_token).toBe('legacy-raw-b');
    expect(out.bots[1].bot_token).toBe(configSecretRefPath('org', 'bots', 'bot-a', 'bot_token'));
  });

  it('drops a placeholder that has no stored counterpart instead of persisting it', () => {
    const incoming = { bots: [{ type: 'slack', name: 'brand-new', bot_token: REDACTED_SECRET }] };
    const out = restoreRedactedConfigSecrets(incoming, stored) as { bots: Record<string, unknown>[] };
    expect(out.bots[0]['bot_token']).toBeUndefined();
  });

  it('leaves new raw values and refs alone (only placeholders are restored)', () => {
    const incoming = {
      bots: [
        { type: 'slack', name: 'bot-a', bot_token: 'brand-new-raw' },
        { type: 'slack', name: 'bot-b', bot_token: stored.bots[0].bot_token },
      ],
    };
    const out = restoreRedactedConfigSecrets(incoming, stored) as typeof stored;
    expect(out.bots[0].bot_token).toBe('brand-new-raw');
    expect(out.bots[1].bot_token).toBe(stored.bots[0].bot_token);
  });

  it('a deleted key stays deleted — absence is not a placeholder', () => {
    const incoming = { bots: [{ type: 'slack', name: 'bot-a' }] };
    const out = restoreRedactedConfigSecrets(incoming, stored) as { bots: Record<string, unknown>[] };
    expect(out.bots[0]['bot_token']).toBeUndefined();
  });
});
