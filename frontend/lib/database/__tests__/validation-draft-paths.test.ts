// validateInitData must mirror the REAL uniqueness rule: the partial unique index
// (idx_files_path_published_unique … WHERE draft = false) permits any number of
// DRAFTS on one path — only published documents must be path-unique. The validator
// used to flag every duplicate path, so migrate-db (the only production migration
// path) hard-failed on perfectly legal workspaces holding same-path drafts.
import { describe, it, expect } from 'vitest';
import { validateInitData } from '@/lib/database/validation';

const doc = (id: number, path: string, draft: boolean) => ({
  id, name: `d${id}`, path, type: 'story', content: {},
  references: [], created_at: 't', updated_at: 't', draft, meta: null,
});

const ADMIN = { id: 1, email: 'a@x.co', name: 'A', role: 'admin', home_folder: '/org', created_at: 't', updated_at: 't' };
const init = (documents: unknown[]) => ({ version: 39, users: [ADMIN], documents }) as never;

describe('validateInitData draft-aware path uniqueness', () => {
  it('allows many drafts on one path (the partial unique index does)', () => {
    const r = validateInitData(init([doc(1, '/org/x', true), doc(2, '/org/x', true)]));
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it('allows a draft alongside the published file at the same path', () => {
    const r = validateInitData(init([doc(1, '/org/x', false), doc(2, '/org/x', true)]));
    expect(r.errors).toEqual([]);
  });

  it('still rejects two PUBLISHED documents on one path', () => {
    const r = validateInitData(init([doc(1, '/org/x', false), doc(2, '/org/x', false)]));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e: string) => e.includes("'/org/x'"))).toBe(true);
  });

  it('treats an absent draft field as published (older exports)', () => {
    const legacy = (id: number) => ({ ...doc(id, '/org/y', false), draft: undefined });
    const r = validateInitData(init([legacy(1), legacy(2)]));
    expect(r.valid).toBe(false);
  });
});
