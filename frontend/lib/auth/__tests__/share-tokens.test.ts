import { describe, it, expect } from 'vitest';
import { createShareLink, decodeShareLink, isLiveShareNonce } from '@/lib/auth/share-tokens';

describe('share-tokens (nonce-only ids)', () => {
  it('round-trips the nonce through create/decode', () => {
    const { shareableId, record } = createShareLink('Acme Demo Story', 7);
    expect(decodeShareLink(shareableId)).toEqual({ nonce: record.nonce });
  });

  it('builds a short `<slug>-<nonce>` id', () => {
    const { shareableId, record } = createShareLink('Acme Demo Story', 1);
    expect(record.slug).toBe('acme-demo-story');
    expect(shareableId).toBe(`acme-demo-story-${record.nonce}`);
    // dramatically shorter than the old JWT form
    expect(shareableId.length).toBeLessThan(45);
    // nonce is base36 only — never contains the `-` separator
    expect(record.nonce).toMatch(/^[0-9a-z]+$/);
  });

  it('splits on the LAST hyphen, so multi-word slugs decode correctly', () => {
    const { shareableId, record } = createShareLink('A Very Long Multi Word Name', 1);
    expect(record.slug).toBe('a-very-long-multi-word-name');
    expect(decodeShareLink(shareableId)).toEqual({ nonce: record.nonce });
  });

  it('captures createdBy + a strong random nonce in the record', () => {
    const { record } = createShareLink('Acme', 99);
    expect(record.createdBy).toBe(99);
    expect(record.nonce.length).toBeGreaterThanOrEqual(12);
    expect(typeof record.createdAt).toBe('string');
  });

  it('mints a distinct nonce per link', () => {
    expect(createShareLink('Acme', 1).record.nonce).not.toBe(createShareLink('Acme', 1).record.nonce);
  });

  it('handles a name with no slug-able characters', () => {
    const { shareableId, record } = createShareLink('!!!', 1);
    expect(record.slug).toBe('');
    expect(shareableId).toBe(record.nonce);
    expect(decodeShareLink(shareableId)).toEqual({ nonce: record.nonce });
  });

  it('returns null for garbage / empty / non-nonce tails', () => {
    expect(decodeShareLink('')).toBeNull();
    expect(decodeShareLink('slug-UPPERCASE')).toBeNull(); // base36 is lowercase
    expect(decodeShareLink('slug-ab')).toBeNull();        // too short
  });

  it('isLiveShareNonce respects revocation', () => {
    const { record } = createShareLink('Acme', 1);
    expect(isLiveShareNonce(record.nonce, [record])).toBe(true);
    expect(isLiveShareNonce(record.nonce, [{ ...record, revoked: true }])).toBe(false);
    expect(isLiveShareNonce('other', [record])).toBe(false);
    expect(isLiveShareNonce(record.nonce, undefined)).toBe(false);
  });
});
