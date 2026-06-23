// Regression: questionv2 / storyv2 files must be indexed by the agent's file search.
// Previously they were skipped (no SEARCH_CONFIGS entry) and excluded from the default
// search types, so the agent "couldn't find" them on the Explore page.
import { describe, it, expect } from 'vitest';
import { searchFiles } from '../file-search';
import type { DbFile } from '@/lib/types';

function qv2(name: string, jsx: string): DbFile {
  return {
    id: 1, name, path: `/org/${name}`, type: 'questionv2',
    content: { description: '' }, jsx, references: [], version: 1, last_edit_id: null, draft: false,
    created_at: '', updated_at: '',
  } as unknown as DbFile;
}

describe('file search — v2 types', () => {
  it('matches a questionv2 by name', () => {
    const results = searchFiles([qv2('stars-ratio', '<Question connection="github">{`SELECT 1`}</Question>')], 'stars');
    expect(results.some((r) => r.matchCount > 0)).toBe(true);
  });

  it('matches a questionv2 by SQL in its jsx body', () => {
    const results = searchFiles([qv2('metrics', '<Question connection="github">{`SELECT actor_login FROM github_events`}</Question>')], 'github_events');
    expect(results.some((r) => r.matchCount > 0)).toBe(true);
  });
});
