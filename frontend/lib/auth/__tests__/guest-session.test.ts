import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { NEXTAUTH_SECRET } from '@/lib/config';
import {
  createGuestToken, verifyGuestToken, guestToEffectiveUser, deriveGuestUid,
  storyHomeFolder, guestChatDenialReason, isShareGuestPath, GUEST_TTL_SECONDS,
} from '@/lib/auth/guest-session';
import { canAccessFile } from '@/lib/data/helpers/permissions';
import type { DbFile } from '@/lib/types';

const basePayload = {
  fileId: 10,
  nonce: 'nonce-abc',
  home_folder: 'demos/acme',
  mode: 'org' as const,
  uid: deriveGuestUid('nonce-abc', 'guest@anon.share'),
  name: 'Guest',
  email: 'guest@anon.share',
  canChat: true,
};

function file(path: string, type: DbFile['type'] = 'question'): DbFile {
  return {
    id: 1, name: 'f', path, type,
    content: {}, file_references: [], version: 1, last_edit_id: null, meta: null,
    created_at: '', updated_at: '',
  } as unknown as DbFile;
}

describe('guest-session tokens', () => {
  it('round-trips a guest payload through create/verify', () => {
    const token = createGuestToken(basePayload);
    const decoded = verifyGuestToken(token);
    expect(decoded).toMatchObject({ ...basePayload, scope: 'share' });
    expect(decoded!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(decoded!.exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + GUEST_TTL_SECONDS + 2);
  });

  it('rejects tampered, wrong-scope, and empty tokens', () => {
    expect(verifyGuestToken(undefined)).toBeNull();
    expect(verifyGuestToken('garbage')).toBeNull();
    expect(verifyGuestToken(createGuestToken(basePayload) + 'x')).toBeNull();
    const wrongScope = jwt.sign({ ...basePayload, scope: 'otp', exp: Math.floor(Date.now() / 1000) + 99 }, NEXTAUTH_SECRET);
    expect(verifyGuestToken(wrongScope)).toBeNull();
  });

  it('derives a stable, negative, email-scoped uid', () => {
    const a = deriveGuestUid('n', 'a@x.com');
    expect(a).toBe(deriveGuestUid('n', 'a@x.com'));
    expect(a).toBeLessThan(-1); // never collides with the cron -1 user or real positive ids
    expect(deriveGuestUid('n', 'b@x.com')).not.toBe(a);
    expect(deriveGuestUid('m', 'a@x.com')).not.toBe(a);
  });

  it('storyHomeFolder returns the story\'s containing folder, relative', () => {
    expect(storyHomeFolder('/org/demos/acme/my-story', 'org')).toBe('demos/acme');
    expect(storyHomeFolder('/tutorial/demos/acme/s', 'tutorial')).toBe('demos/acme');
  });
});

describe('guest scoping via canAccessFile', () => {
  const guest = guestToEffectiveUser({ ...basePayload, exp: 0, scope: 'share' });

  it('builds a folder-pinned viewer', () => {
    expect(guest.role).toBe('viewer');
    expect(guest.home_folder).toBe('demos/acme');
    expect(guest.userId).toBeLessThan(0);
  });

  it('can access files inside the shared folder', () => {
    expect(canAccessFile(file('/org/demos/acme'), guest)).toBe(true);
    expect(canAccessFile(file('/org/demos/acme/the-story', 'story'), guest)).toBe(true);
    expect(canAccessFile(file('/org/demos/acme/a-question'), guest)).toBe(true);
  });

  it('CANNOT access sibling folders or other companies', () => {
    expect(canAccessFile(file('/org/demos/other-co/secret'), guest)).toBe(false);
    expect(canAccessFile(file('/org/demos'), guest)).toBe(false); // parent, outside home
    expect(canAccessFile(file('/org/finance/payroll'), guest)).toBe(false);
  });

  it('CANNOT cross into another mode', () => {
    expect(canAccessFile(file('/tutorial/demos/acme/the-story', 'story'), guest)).toBe(false);
  });
});

describe('isShareGuestPath — guest cookie scope', () => {
  it('honors the guest cookie ONLY on share pages + the APIs they call', () => {
    expect(isShareGuestPath('/l/some-story--token')).toBe(true);
    expect(isShareGuestPath('/api/files/1263')).toBe(true);
    expect(isShareGuestPath('/api/query')).toBe(true);
    expect(isShareGuestPath('/api/chat/stream')).toBe(true);
  });

  it('ignores the guest cookie on the main app UI (no login leakage)', () => {
    expect(isShareGuestPath('/')).toBe(false);
    expect(isShareGuestPath('/home')).toBe(false);
    expect(isShareGuestPath('/explore')).toBe(false);
    expect(isShareGuestPath('/f/1263')).toBe(false);
    expect(isShareGuestPath('/files')).toBe(false);
    expect(isShareGuestPath(null)).toBe(false);
    expect(isShareGuestPath(undefined)).toBe(false);
  });
});

describe('guestChatDenialReason', () => {
  const mk = (over: Partial<typeof basePayload>) =>
    guestToEffectiveUser({ ...basePayload, ...over, exp: 0, scope: 'share' });

  it('allows a non-guest (no marker) unconditionally', () => {
    const realUser = { ...mk({}), guest: undefined };
    expect(guestChatDenialReason(realUser, false)).toBeNull();
  });

  it('blocks when chat is globally disabled', () => {
    expect(guestChatDenialReason(mk({ canChat: true }), false)).toMatch(/not available/i);
  });

  it('blocks an un-gated guest even when chat is enabled', () => {
    expect(guestChatDenialReason(mk({ canChat: false }), true)).toMatch(/name and email/i);
  });

  it('allows a gated guest when chat is enabled', () => {
    expect(guestChatDenialReason(mk({ canChat: true }), true)).toBeNull();
  });
});
