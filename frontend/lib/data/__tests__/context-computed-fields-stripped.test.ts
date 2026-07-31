/**
 * Saving a context must not persist the loader's computed fields.
 *
 * `contextLoader` decorates a context with derived state — the resolved schema,
 * inherited docs/metrics/views/models, and the diagnostics that explain what got
 * disabled. That state is a VIEW over the context tree, recomputed on every read.
 * The browser round-trips whatever it was handed, so `saveFile` strips those keys
 * before writing.
 *
 * It stripped five of the twelve. The other seven were written into the `files`
 * row on every context save: row bloat, plus a frozen copy of derived state that
 * silently disagrees with the tree the moment a parent changes. Nothing caught it
 * — Ajv runs without `removeAdditional` and the context schema does not name these
 * keys, so they are neither rejected nor removed.
 *
 * The source of truth is `ContextContent` itself, where each of these is annotated
 * "Computed by loader". This test enumerates all twelve so that adding a
 * thirteenth without stripping it fails here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FilesAPI } from '@/lib/data/files.server';
import { DocumentDB } from '@/lib/database/documents-db';
import { initTestDatabase, cleanupTestDatabase, getTestDbPath } from '@/store/__tests__/test-utils';
import { COMPUTED_CONTEXT_FIELDS } from '@/lib/types/context';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const TEST_DB_PATH = getTestDbPath('context_computed_strip');
const user: EffectiveUser = {
  userId: 1, name: 'A', email: 'a@x.com', role: 'admin', mode: 'org', home_folder: '',
};

/** The minimum a context needs to survive the save path's loader call. */
const BASE_CONTEXT = {
  versions: [{ version: 1, whitelist: [], docs: [], createdAt: 't', createdBy: 1 }],
  published: { all: 1 },
};

/** A context carrying every loader-computed key, as the browser would send it back. */
function decoratedContext(): Record<string, unknown> {
  const decorated: Record<string, unknown> = { ...BASE_CONTEXT, name: 'ctx', description: 'a context' };
  for (const key of COMPUTED_CONTEXT_FIELDS) decorated[key] = [{ marker: key }];
  return decorated;
}

describe('saveFile strips loader-computed fields from a context', () => {
  beforeEach(async () => { await initTestDatabase(TEST_DB_PATH); });
  afterEach(async () => { await cleanupTestDatabase(TEST_DB_PATH); vi.restoreAllMocks(); });

  it('persists none of them', async () => {
    const { data } = await FilesAPI.createFile(
      { name: 'ctx', path: '/org/ctx', type: 'context', content: { ...BASE_CONTEXT, name: 'ctx' } },
      user,
    );
    await FilesAPI.saveFile(data.id, 'ctx', '/org/ctx', decoratedContext(), [], user);

    const row = await DocumentDB.getById(data.id);
    const stored = (row?.content ?? {}) as Record<string, unknown>;

    const leaked = COMPUTED_CONTEXT_FIELDS.filter((k) => k in stored);
    expect(leaked).toEqual([]);
  });

  it('keeps the authored fields it was given', async () => {
    const { data } = await FilesAPI.createFile(
      { name: 'ctx2', path: '/org/ctx2', type: 'context', content: { ...BASE_CONTEXT, name: 'ctx2' } },
      user,
    );
    await FilesAPI.saveFile(data.id, 'ctx2', '/org/ctx2', decoratedContext(), [], user);

    const stored = ((await DocumentDB.getById(data.id))?.content ?? {}) as Record<string, unknown>;
    expect(stored.description).toBe('a context');
  });
});
