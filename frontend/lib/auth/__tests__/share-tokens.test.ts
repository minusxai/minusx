import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { NEXTAUTH_SECRET } from '@/lib/config';
import { createShareLink, decodeShareLink } from '@/lib/auth/share-tokens';

describe('share-tokens', () => {
  it('round-trips fileId + nonce through create/decode', () => {
    const { shareableId, record } = createShareLink(42, 'Acme Demo Story', 7);
    const decoded = decodeShareLink(shareableId);
    expect(decoded).toEqual({ fileId: 42, nonce: record.nonce });
  });

  it('builds a human-readable slug prefix joined by the -- sentinel', () => {
    const { shareableId, record } = createShareLink(1, 'Acme Demo Story', 1);
    expect(record.slug).toBe('acme-demo-story');
    expect(shareableId.startsWith('acme-demo-story--')).toBe(true);
    // the slug part itself never contains the sentinel
    expect(shareableId.indexOf('--')).toBe('acme-demo-story'.length);
  });

  it('captures createdBy and a non-empty random nonce in the record', () => {
    const { record } = createShareLink(5, 'Acme', 99);
    expect(record.createdBy).toBe(99);
    expect(typeof record.nonce).toBe('string');
    expect(record.nonce.length).toBeGreaterThan(8);
    expect(typeof record.createdAt).toBe('string');
  });

  it('mints a distinct nonce per link for the same file', () => {
    const a = createShareLink(1, 'Acme', 1);
    const b = createShareLink(1, 'Acme', 1);
    expect(a.record.nonce).not.toBe(b.record.nonce);
  });

  it('returns null for a tampered token', () => {
    const { shareableId } = createShareLink(42, 'Acme', 1);
    const tampered = shareableId.slice(0, -2) + 'xx';
    expect(decodeShareLink(tampered)).toBeNull();
  });

  it('returns null for a JWT signed with the wrong type discriminator', () => {
    const forged = jwt.sign({ fileId: 42, nonce: 'abc', type: 'otp' }, NEXTAUTH_SECRET);
    expect(decodeShareLink(`acme--${forged}`)).toBeNull();
  });

  it('returns null for garbage / missing sentinel', () => {
    expect(decodeShareLink('not-a-real-link')).toBeNull();
    expect(decodeShareLink('')).toBeNull();
  });

  it('ignores the cosmetic slug when decoding', () => {
    const { shareableId, record } = createShareLink(42, 'Acme Demo Story', 1);
    const jwtTail = shareableId.slice(shareableId.indexOf('--') + 2);
    const decoded = decodeShareLink(`anything-else--${jwtTail}`);
    expect(decoded).toEqual({ fileId: 42, nonce: record.nonce });
  });
});
