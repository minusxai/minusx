/**
 * Non-admin access to `viz` recipe files. Admin's wildcard rule hides a missing
 * type registration in rules.json (recipe resolution runs AS THE ACTING USER,
 * so a type absent from a role's lists makes every recipe invisible for that
 * role — no tiles, no advertisement, no freeze resolution). Editors get full
 * access; viewers can see recipes (read surfaces + selector tiles) but not
 * create them.
 */
import { describe, it, expect } from 'vitest';
import { canAccessFileType, canViewFileType, canCreateFileByRole } from '@/lib/auth/access-rules';

describe('viz recipe file access by role', () => {
  it('editors can access, view, and create viz recipes', () => {
    expect(canAccessFileType('editor', 'viz')).toBe(true);
    expect(canViewFileType('editor', 'viz')).toBe(true);
    expect(canCreateFileByRole('editor', 'viz')).toBe(true);
  });

  it('viewers can access and view viz recipes but not create them', () => {
    expect(canAccessFileType('viewer', 'viz')).toBe(true);
    expect(canViewFileType('viewer', 'viz')).toBe(true);
    expect(canCreateFileByRole('viewer', 'viz')).toBe(false);
  });

  it('admins have wildcard access', () => {
    expect(canAccessFileType('admin', 'viz')).toBe(true);
    expect(canCreateFileByRole('admin', 'viz')).toBe(true);
  });
});
