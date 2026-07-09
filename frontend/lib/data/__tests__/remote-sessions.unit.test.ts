// Remote Agent Sessions — pure session-code + liveness logic (no DB).

import {
  encodeRemoteSessionCode,
  decodeRemoteSessionCode,
  generateRemoteSessionNonce,
  hashRemoteSessionNonce,
  verifyRemoteSessionNonce,
  buildRemoteSessionRecord,
  remoteSessionDenial,
} from '@/lib/data/remote-sessions.server';
import type { RemoteSessionRecord } from '@/lib/data/remote-sessions.types';

describe('remote session code codec', () => {
  it('encode/decode round-trips conversation id + nonce', () => {
    const nonce = generateRemoteSessionNonce();
    const code = encodeRemoteSessionCode(4321, nonce);
    expect(decodeRemoteSessionCode(code)).toEqual({ conversationId: 4321, nonce });
  });

  it('nonce is base36 and long enough to be unguessable', () => {
    const nonce = generateRemoteSessionNonce();
    expect(nonce).toMatch(/^[0-9a-z]{16,40}$/);
  });

  it('decode rejects garbage', () => {
    expect(decodeRemoteSessionCode('')).toBeNull();
    expect(decodeRemoteSessionCode('no-separator!!')).toBeNull();
    expect(decodeRemoteSessionCode('zzz')).toBeNull();
    expect(decodeRemoteSessionCode('-abc123abc123abc123')).toBeNull();
    expect(decodeRemoteSessionCode('notbase36!-abcdefabcdefabcdef')).toBeNull();
    // Nonce too short to be one of ours.
    expect(decodeRemoteSessionCode('1a-short')).toBeNull();
  });
});

describe('nonce hashing', () => {
  it('verify passes for the right nonce and fails for a tampered one', () => {
    const nonce = generateRemoteSessionNonce();
    const hash = hashRemoteSessionNonce(nonce);
    expect(hash).not.toContain(nonce); // hash, not plaintext
    expect(verifyRemoteSessionNonce(nonce, hash)).toBe(true);
    expect(verifyRemoteSessionNonce(nonce.slice(0, -1) + (nonce.endsWith('a') ? 'b' : 'a'), hash)).toBe(false);
    expect(verifyRemoteSessionNonce('', hash)).toBe(false);
    expect(verifyRemoteSessionNonce(nonce, 'deadbeef')).toBe(false); // length mismatch must not throw
  });
});

describe('remote session liveness', () => {
  const NOW = Date.parse('2026-07-09T12:00:00.000Z');

  function liveRecord(overrides: Partial<RemoteSessionRecord> = {}): { nonce: string; record: RemoteSessionRecord } {
    const { nonce, record } = buildRemoteSessionRecord(1, NOW);
    return { nonce, record: { ...record, ...overrides } };
  }

  it('a fresh record is live', () => {
    const { nonce, record } = liveRecord();
    expect(remoteSessionDenial(record, nonce, NOW)).toBeNull();
    // Also live right up to (but not past) expiry.
    expect(remoteSessionDenial(record, nonce, Date.parse(record.expiresAt) - 1)).not.toBe('expired');
  });

  it('missing record or wrong nonce → not_found', () => {
    const { nonce } = liveRecord();
    expect(remoteSessionDenial(undefined, nonce, NOW)).toBe('not_found');
    const { record } = liveRecord();
    expect(remoteSessionDenial(record, generateRemoteSessionNonce(), NOW)).toBe('not_found');
  });

  it('revoked → revoked', () => {
    const { nonce, record } = liveRecord({ revoked: true });
    expect(remoteSessionDenial(record, nonce, NOW)).toBe('revoked');
  });

  it('past hard TTL → expired', () => {
    const { nonce, record } = liveRecord();
    expect(remoteSessionDenial(record, nonce, Date.parse(record.expiresAt) + 1)).toBe('expired');
  });

  it('idle past the idle timeout → idle_expired', () => {
    const { nonce, record } = liveRecord();
    const idleAt = Date.parse(record.lastActivityAt) + record.idleTimeoutMs + 1;
    // Keep under the hard TTL so we specifically exercise the idle path.
    expect(idleAt).toBeLessThan(Date.parse(record.expiresAt));
    expect(remoteSessionDenial(record, nonce, idleAt)).toBe('idle_expired');
  });

  it('record fields: TTL and idle timeout are sane defaults', () => {
    const { record } = liveRecord();
    expect(record.createdBy).toBe(1);
    expect(record.toolset).toBe('remote-session');
    expect(Date.parse(record.expiresAt) - Date.parse(record.createdAt)).toBeGreaterThanOrEqual(60 * 60 * 1000);
    expect(record.idleTimeoutMs).toBeGreaterThanOrEqual(5 * 60 * 1000);
  });
});
