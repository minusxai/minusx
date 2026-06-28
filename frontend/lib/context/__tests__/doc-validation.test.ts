import { describe, it, expect } from 'vitest';
import { isDocMetaIncomplete, anyDocMetaIncomplete } from '@/lib/context/doc-validation';
import type { DocEntry } from '@/lib/types';

const doc = (over: Partial<DocEntry>): DocEntry => ({ content: 'body', ...over });

describe('isDocMetaIncomplete', () => {
  it('is false for an active doc with both title and description', () => {
    expect(isDocMetaIncomplete(doc({ title: 'T', description: 'D' }))).toBe(false);
  });

  it('is true for an active doc missing the title', () => {
    expect(isDocMetaIncomplete(doc({ description: 'D' }))).toBe(true);
  });

  it('is true for an active doc missing the description', () => {
    expect(isDocMetaIncomplete(doc({ title: 'T' }))).toBe(true);
  });

  it('treats whitespace-only title/description as empty', () => {
    expect(isDocMetaIncomplete(doc({ title: '  ', description: 'D' }))).toBe(true);
  });

  it('is false for a draft doc even when title/description are empty (drafts are WIP)', () => {
    expect(isDocMetaIncomplete(doc({ draft: true }))).toBe(false);
  });

  it('is false for a legacy string doc (no meta concept)', () => {
    expect(isDocMetaIncomplete('legacy markdown')).toBe(false);
  });
});

describe('anyDocMetaIncomplete', () => {
  it('is true when at least one active doc is missing meta', () => {
    expect(anyDocMetaIncomplete([doc({ title: 'T', description: 'D' }), doc({ title: 'T' })])).toBe(true);
  });

  it('is false when all active docs have title + description (drafts ignored)', () => {
    expect(anyDocMetaIncomplete([doc({ title: 'T', description: 'D' }), doc({ draft: true })])).toBe(false);
  });

  it('is false for an empty list', () => {
    expect(anyDocMetaIncomplete([])).toBe(false);
  });
});
