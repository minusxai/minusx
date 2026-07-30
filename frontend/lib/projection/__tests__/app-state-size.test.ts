// The "large file" trigger must measure what the LLM actually receives, not the raw Redux app
// state. The projection pass strips query-result rows (`stripQueryData`) and never emits reference
// markup, so a file with megabytes of result rows but small markup has a tiny prompt footprint —
// it must NOT trip the large-file skill, even though `JSON.stringify(appState)` is huge.
import { describe, it, expect } from 'vitest';
import {
  LARGE_APP_STATE_THRESHOLD,
  projectedAppStateChars,
  shouldInjectLargeFileSkill,
} from '../app-state-size';
import type { AppState } from '@/lib/appState';
import type { CompressedAugmentedFile, CompressedFileState } from '@/lib/types';

const rows = (chars: number) => `| a |\n| --- |\n${'| 1 |\n'.repeat(Math.ceil(chars / 6))}`;
const markup = (chars: number) => `<story>${'x'.repeat(chars)}</story>`;

const fileState = (id: number, name: string, m: string): CompressedFileState => ({
  id,
  name,
  path: `/org/${name}`,
  type: 'question',
  isDirty: false,
  queryResultId: `h${id}`,
  markup: m,
});

const caf = (opts: {
  markup: string;
  dataChars?: number;
  references?: Array<{ id: number; markup: string }>;
}): CompressedAugmentedFile => ({
  fileState: fileState(1, 'primary', opts.markup),
  references: (opts.references ?? []).map(r => fileState(r.id, `ref${r.id}`, r.markup)),
  queryResults: [
    {
      id: 'h1',
      columns: ['a'],
      types: ['number'],
      data: opts.dataChars ? rows(opts.dataChars) : '',
      totalRows: 1,
      shownRows: 1,
      truncated: false,
    },
  ],
});

const fileAppState = (aug: CompressedAugmentedFile): AppState => ({ type: 'file', state: aug });

const rawChars = (s: AppState) => JSON.stringify(s).length;

describe('projectedAppStateChars', () => {
  it('excludes query-result row data — a file with huge results but small markup projects small', () => {
    const state = fileAppState(caf({ markup: markup(500), dataChars: 400_000 }));
    expect(rawChars(state)).toBeGreaterThan(LARGE_APP_STATE_THRESHOLD);
    const projected = projectedAppStateChars(state);
    expect(projected).toBeLessThan(rawChars(state) / 10);
    expect(projected).toBeLessThan(LARGE_APP_STATE_THRESHOLD);
  });

  it('counts the primary file markup — genuinely huge markup projects large', () => {
    const state = fileAppState(caf({ markup: markup(LARGE_APP_STATE_THRESHOLD + 5_000) }));
    expect(projectedAppStateChars(state)).toBeGreaterThan(LARGE_APP_STATE_THRESHOLD);
  });

  it('excludes reference markup (references are metadata-only in app state)', () => {
    const withRefs = fileAppState(
      caf({ markup: markup(100), references: [{ id: 2, markup: markup(300_000) }] }),
    );
    expect(rawChars(withRefs)).toBeGreaterThan(LARGE_APP_STATE_THRESHOLD);
    expect(projectedAppStateChars(withRefs)).toBeLessThan(LARGE_APP_STATE_THRESHOLD);
  });

  // Calibration against the real distribution of authored story markup (21 stories in local
  // workspaces: median 248, p95 15.6k, max 103k chars). Ordinary stories must pass; the monster
  // must trip. These pin the threshold to observed data rather than a guess.
  it('does not flag a p95-sized real story (~16k chars of markup)', () => {
    expect(shouldInjectLargeFileSkill(fileAppState(caf({ markup: markup(15_600) })))).toBe(false);
  });

  it('flags the largest real authored story (~103k chars of markup)', () => {
    expect(shouldInjectLargeFileSkill(fileAppState(caf({ markup: markup(103_467) })))).toBe(true);
  });

  it('is idempotent — a fresh memo per call, so repeat measurements do not collapse to unchanged', () => {
    const state = fileAppState(caf({ markup: markup(50_000) }));
    const first = projectedAppStateChars(state);
    expect(projectedAppStateChars(state)).toBe(first);
    expect(first).toBeGreaterThan(50_000);
  });

  it('handles non-file app state, undefined and null', () => {
    expect(projectedAppStateChars(undefined)).toBe(0);
    expect(projectedAppStateChars(null)).toBe(0);
    // non-file pages render their JSON inline — small, and never large enough to trip the skill
    const explore: AppState = { type: 'explore', state: null };
    expect(projectedAppStateChars(explore)).toBeGreaterThan(0);
    expect(shouldInjectLargeFileSkill(explore)).toBe(false);
  });
});

describe('shouldInjectLargeFileSkill', () => {
  it('is false for a file whose bulk is query-result rows (the raw-JSON measure said true)', () => {
    const state = fileAppState(caf({ markup: markup(500), dataChars: 400_000 }));
    expect(rawChars(state)).toBeGreaterThan(LARGE_APP_STATE_THRESHOLD); // old measure → true
    expect(shouldInjectLargeFileSkill(state)).toBe(false);
  });

  it('is true for genuinely huge markup', () => {
    expect(shouldInjectLargeFileSkill(fileAppState(caf({ markup: markup(LARGE_APP_STATE_THRESHOLD + 5_000) })))).toBe(true);
  });

  it('is false for no app state', () => {
    expect(shouldInjectLargeFileSkill(undefined)).toBe(false);
  });
});
