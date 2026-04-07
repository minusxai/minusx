import { canAccessFile, checkFileAccess } from '../permissions';
import type { DbFile } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(path: string, type: DbFile['type'] = 'conversation'): DbFile {
  return {
    id: 1,
    name: 'test',
    path,
    type,
    references: [],
    version: 1,
    last_edit_id: null,
    content: null,
    company_id: 1,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };
}

function makeUser(overrides: Partial<EffectiveUser> = {}): EffectiveUser {
  return {
    userId: 42,
    email: 'editor@company.com',
    name: 'Editor',
    role: 'editor',
    home_folder: '',   // default DB value → resolves to /org
    companyId: 1,
    mode: 'org',
    ...overrides,
  };
}

const OWN_USER_ID = '42';   // matches makeUser default userId
const OTHER_USER_ID = '99';

// ---------------------------------------------------------------------------
// canAccessFile
// ---------------------------------------------------------------------------

describe('canAccessFile — system folder access', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe('non-admin with root home_folder (home_folder="")', () => {
    const editor = makeUser({ role: 'editor' });
    const viewer = makeUser({ role: 'viewer' });

    it('denies access to /org/logs folder', () => {
      const file = makeFile('/org/logs', 'folder');
      expect(canAccessFile(file, editor)).toBe(false);
      expect(canAccessFile(file, viewer)).toBe(false);
    });

    it('denies access to /org/logs/conversations folder', () => {
      const file = makeFile('/org/logs/conversations', 'folder');
      expect(canAccessFile(file, editor)).toBe(false);
      expect(canAccessFile(file, viewer)).toBe(false);
    });

    it('denies access to another user\'s conversation', () => {
      const file = makeFile(`/org/logs/conversations/${OTHER_USER_ID}/conv-1`);
      expect(canAccessFile(file, editor)).toBe(false);
      expect(canAccessFile(file, viewer)).toBe(false);
    });

    it('grants access to own conversation', () => {
      const file = makeFile(`/org/logs/conversations/${OWN_USER_ID}/conv-1`);
      expect(canAccessFile(file, editor)).toBe(true);
      expect(canAccessFile(file, viewer)).toBe(true);
    });

    it('grants access to a connection in /org/database (system path whitelist)', () => {
      const file = makeFile('/org/database/conn-1', 'connection');
      expect(canAccessFile(file, editor)).toBe(true);
    });
  });

  describe('non-admin with a specific home_folder', () => {
    const editor = makeUser({ role: 'editor', home_folder: 'sales' });

    it('denies access to /org/logs folder (blocked by both home folder and system folder checks)', () => {
      const file = makeFile('/org/logs', 'folder');
      expect(canAccessFile(file, editor)).toBe(false);
    });

    it('still grants access to own conversation', () => {
      const file = makeFile(`/org/logs/conversations/${OWN_USER_ID}/conv-1`);
      expect(canAccessFile(file, editor)).toBe(true);
    });

    it('still denies access to another user\'s conversation', () => {
      const file = makeFile(`/org/logs/conversations/${OTHER_USER_ID}/conv-1`);
      expect(canAccessFile(file, editor)).toBe(false);
    });
  });

  describe('admin access is unaffected', () => {
    const admin = makeUser({ role: 'admin' });

    it('grants access to /org/logs folder', () => {
      const file = makeFile('/org/logs', 'folder');
      expect(canAccessFile(file, admin)).toBe(true);
    });

    it('grants access to /org/logs/conversations folder', () => {
      const file = makeFile('/org/logs/conversations', 'folder');
      expect(canAccessFile(file, admin)).toBe(true);
    });

    it('grants access to any user\'s conversation', () => {
      const file = makeFile(`/org/logs/conversations/${OTHER_USER_ID}/conv-1`);
      expect(canAccessFile(file, admin)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// checkFileAccess — same cases (older function, same homeAccess pattern)
// ---------------------------------------------------------------------------

describe('checkFileAccess — system folder access', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe('non-admin with root home_folder (home_folder="")', () => {
    const editor = makeUser({ role: 'editor' });

    it('denies access to /org/logs folder', () => {
      const file = makeFile('/org/logs', 'folder');
      expect(checkFileAccess(file, editor)).toBe(false);
    });

    it('denies access to another user\'s conversation', () => {
      const file = makeFile(`/org/logs/conversations/${OTHER_USER_ID}/conv-1`);
      expect(checkFileAccess(file, editor)).toBe(false);
    });

    it('grants access to own conversation', () => {
      const file = makeFile(`/org/logs/conversations/${OWN_USER_ID}/conv-1`);
      expect(checkFileAccess(file, editor)).toBe(true);
    });
  });

  describe('admin access is unaffected', () => {
    const admin = makeUser({ role: 'admin' });

    it('grants access to /org/logs folder', () => {
      const file = makeFile('/org/logs', 'folder');
      expect(checkFileAccess(file, admin)).toBe(true);
    });

    it('grants access to another user\'s conversation', () => {
      const file = makeFile(`/org/logs/conversations/${OTHER_USER_ID}/conv-1`);
      expect(checkFileAccess(file, admin)).toBe(true);
    });
  });
});
