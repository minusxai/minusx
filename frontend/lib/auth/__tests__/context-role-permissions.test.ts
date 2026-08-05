import { describe, expect, it } from 'vitest';
import {
  canAccessFileType,
  canCreateFileByRole as canCreateFileByRoleServer,
  canViewFileType as canViewFileTypeServer,
} from '@/lib/auth/access-rules';
import {
  canCreateFileByRole as canCreateFileByRoleClient,
  canViewFileType as canViewFileTypeClient,
} from '@/lib/auth/access-rules.client';

describe('context role permissions', () => {
  it('keeps contexts loadable but hidden and read-only for viewers', () => {
    expect(canAccessFileType('viewer', 'context')).toBe(true);
    expect(canViewFileTypeServer('viewer', 'context')).toBe(false);
    expect(canViewFileTypeClient('viewer', 'context')).toBe(false);
    expect(canCreateFileByRoleServer('viewer', 'context')).toBe(false);
    expect(canCreateFileByRoleClient('viewer', 'context')).toBe(false);
  });

  it('lets editors view and edit contexts on both permission paths', () => {
    expect(canAccessFileType('editor', 'context')).toBe(true);
    expect(canViewFileTypeServer('editor', 'context')).toBe(true);
    expect(canViewFileTypeClient('editor', 'context')).toBe(true);
    expect(canCreateFileByRoleServer('editor', 'context')).toBe(true);
    expect(canCreateFileByRoleClient('editor', 'context')).toBe(true);
  });

  it('lets admins view and edit contexts on both permission paths', () => {
    expect(canAccessFileType('admin', 'context')).toBe(true);
    expect(canViewFileTypeServer('admin', 'context')).toBe(true);
    expect(canViewFileTypeClient('admin', 'context')).toBe(true);
    expect(canCreateFileByRoleServer('admin', 'context')).toBe(true);
    expect(canCreateFileByRoleClient('admin', 'context')).toBe(true);
  });
});
